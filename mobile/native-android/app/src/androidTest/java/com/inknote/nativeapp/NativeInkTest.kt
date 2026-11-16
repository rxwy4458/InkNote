package com.inknote.nativeapp

import android.graphics.Bitmap
import android.graphics.PointF
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import androidx.ink.brush.InputToolType
import androidx.ink.strokes.MutableStrokeInputBatch
import androidx.ink.strokes.Stroke
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class NativeInkTest {
    @get:Rule val activity = ActivityScenarioRule(MainActivity::class.java)
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    private fun surface(): InkSurface {
        lateinit var result: InkSurface
        activity.scenario.onActivity { a -> result = InkSurface(a); a.setContentView(result) }
        instrumentation.waitForIdleSync()
        return result
    }

    private fun send(view: InkSurface, down: Long, time: Long, action: Int, ids: IntArray,
                     types: IntArray, xs: FloatArray, ys: FloatArray, pressures: FloatArray, flags: Int = 0) {
        val properties = ids.indices.map { i -> MotionEvent.PointerProperties().apply { id = ids[i]; toolType = types[i] } }.toTypedArray()
        val coords = ids.indices.map { i -> MotionEvent.PointerCoords().apply { x = xs[i]; y = ys[i]; pressure = pressures[i]; size = .1f } }.toTypedArray()
        val event = MotionEvent.obtain(down, time, action, ids.size, properties, coords, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_STYLUS, flags)
        activity.scenario.onActivity { view.dispatchTouchEvent(event) }
        event.recycle()
    }

    private fun stroke(view: InkSurface, cancel: Boolean = false): List<InkRecord> {
        val latch = CountDownLatch(1); var result = emptyList<InkRecord>()
        activity.scenario.onActivity { val original = view.onChange; view.onChange = { original(it); result = it; latch.countDown() } }
        val down = SystemClock.uptimeMillis(); val x = view.width / 2f; val y = view.height / 2f
        val types = intArrayOf(MotionEvent.TOOL_TYPE_STYLUS)
        for (i in 0..4) send(view, down, down + i * 8,
            when (i) { 0 -> MotionEvent.ACTION_DOWN; 4 -> if (cancel) MotionEvent.ACTION_CANCEL else MotionEvent.ACTION_UP; else -> MotionEvent.ACTION_MOVE },
            intArrayOf(7), types, floatArrayOf(x + i * 8), floatArrayOf(y + i * 4), floatArrayOf(.2f + i * .15f))
        if (cancel) assertFalse("Cancelled stroke must never be committed", latch.await(800, TimeUnit.MILLISECONDS))
        else assertTrue("Stroke handoff did not complete", latch.await(20, TimeUnit.SECONDS))
        return result
    }

    @Test fun stylusPressureSurvivesPersistenceAndPredictionIsNotSaved() {
        val view = surface(); val records = stroke(view)
        assertEquals(1, records.size)
        assertEquals(5, records.single().stroke.inputs.size)
        val context = instrumentation.targetContext
        val folder = File(context.cacheDir, "roundtrip-${UUID.randomUUID()}")
        val store = NotebookStore(folder)
        try {
            val note = Notebook(title = "压感测试", pages = listOf(NotePage(strokes = records)))
            store.save(note)
            val (loaded, errors) = store.load()
            assertEquals(0, errors)
            val batch = loaded.single().pages.single().strokes.single().stroke.inputs
            assertEquals(records.single().stroke.inputs.size, batch.size)
            for (i in 0 until batch.size) {
                assertEquals(records.single().stroke.inputs[i].x, batch[i].x, .02f)
                assertEquals(records.single().stroke.inputs[i].pressure, batch[i].pressure, .02f)
                assertEquals(records.single().stroke.inputs[i].elapsedTimeMillis, batch[i].elapsedTimeMillis)
            }
        } finally { folder.deleteRecursively() }
    }

    @Test fun cancellationCreatesNoStroke() { assertTrue(stroke(surface(), cancel = true).isEmpty()) }

    @Test fun palmFirstAndChangingPointerIndexDoNotBreakThePen() {
        val view = surface(); val latch = CountDownLatch(1); var result = emptyList<InkRecord>()
        activity.scenario.onActivity { view.onChange = { result = it; latch.countDown() } }
        val t = SystemClock.uptimeMillis(); val x = view.width / 2f; val y = view.height / 2f
        val finger = MotionEvent.TOOL_TYPE_FINGER; val pen = MotionEvent.TOOL_TYPE_STYLUS
        send(view, t, t, MotionEvent.ACTION_DOWN, intArrayOf(23), intArrayOf(finger), floatArrayOf(x + 100), floatArrayOf(y), floatArrayOf(.7f))
        send(view, t, t + 8, MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), intArrayOf(23, 7), intArrayOf(finger, pen), floatArrayOf(x + 100, x), floatArrayOf(y, y), floatArrayOf(.7f, .3f))
        send(view, t, t + 16, MotionEvent.ACTION_MOVE, intArrayOf(7, 23), intArrayOf(pen, finger), floatArrayOf(x + 16, x + 100), floatArrayOf(y + 8, y), floatArrayOf(.6f, .7f))
        send(view, t, t + 24, MotionEvent.ACTION_POINTER_UP or (1 shl 8), intArrayOf(7, 23), intArrayOf(pen, finger), floatArrayOf(x + 16, x + 100), floatArrayOf(y + 8, y), floatArrayOf(.6f, .7f), MotionEvent.FLAG_CANCELED)
        send(view, t, t + 32, MotionEvent.ACTION_UP, intArrayOf(7), intArrayOf(pen), floatArrayOf(x + 32), floatArrayOf(y + 16), floatArrayOf(.8f))
        assertTrue(latch.await(20, TimeUnit.SECONDS)); assertEquals(1, result.size)
        assertEquals(InputToolType.STYLUS, result.single().stroke.inputs.toolType)
    }

    @Test fun undoRedoAndFastSweptEraserPreserveTheCorrectStroke() {
        val view = surface(); stroke(view)
        activity.scenario.onActivity {
            assertEquals(1, view.strokeCount); view.undo(); assertEquals(0, view.strokeCount)
            view.redo(); assertEquals(1, view.strokeCount)
        }
        val batch = MutableStrokeInputBatch().apply {
            add(InputToolType.STYLUS, 10f, 50f, 0, pressure = .5f)
            add(InputToolType.STYLUS, 90f, 50f, 10, pressure = .5f)
        }
        val record = InkRecord(kind = Tool.PEN, stroke = Stroke(makeBrush(Tool.PEN, 0xff222222.toInt(), 2f), batch))
        assertTrue(intersectsStroke(record, PointF(50f, 0f), PointF(50f, 100f), 2f))
        assertFalse(intersectsStroke(record, PointF(150f, 0f), PointF(150f, 100f), 2f))
    }

    @Test fun editableBackupAndPdfCanBeOpenedAgain() {
        val records = stroke(surface())
        val folder = File(instrumentation.targetContext.cacheDir, "export-${UUID.randomUUID()}")
        val store = NotebookStore(folder)
        try {
            val note = Notebook(title = "导出测试", pages = listOf(NotePage(strokes = records)))
            val archive = ByteArrayOutputStream().also { store.exportBackup(note, it) }.toByteArray()
            val restored = store.importBackup(ByteArrayInputStream(archive))
            assertNotEquals(note.id, restored.id)
            assertEquals(records.single().stroke.inputs.size, restored.pages.single().strokes.single().stroke.inputs.size)
            val output = ByteArrayOutputStream().also { store.exportPdf(restored, it) }.toByteArray()
            assertTrue(String(output.take(4).toByteArray()) == "%PDF")
            val pdf = store.importPdf(ByteArrayInputStream(output), "重新导入")
            assertEquals(1, pdf.pages.size)
            val bitmap = requireNotNull(store.pdfBitmap(pdf, pdf.pages.single(), 512))
            assertTrue(bitmap.width > 0); bitmap.recycle()
        } finally { folder.deleteRecursively() }
    }

    @Test fun densePageAcceptsANewStrokeWithoutLosingHistory() {
        val records = (0 until 1000).map { i ->
            val x = 24f + (i % 40) * 13f; val y = 48f + (i / 40) * 24f
            val batch = MutableStrokeInputBatch().apply {
                add(InputToolType.STYLUS, x, y, 0, pressure = .5f)
                add(InputToolType.STYLUS, x + 8f, y + 6f, 8, pressure = .7f)
            }
            InkRecord(kind = Tool.PEN, stroke = Stroke(makeBrush(Tool.PEN, 0xff333333.toInt(), 1.4f), batch))
        }
        val view = surface()
        activity.scenario.onActivity { view.showPage(NotePage(strokes = records)) }
        instrumentation.waitForIdleSync()
        val all = stroke(view)
        assertEquals(1001, all.size)
        assertEquals(records.map { it.id }, all.take(1000).map { it.id })
    }

    @Test fun nativeLibraryAndEditorAreUsable() {
        val device = UiDevice.getInstance(instrumentation)
        assertTrue(device.wait(Until.hasObject(By.text("新建画布")), 15000))
        screenshot("native-library.png")
        device.findObject(By.text("新建画布")).click()
        assertTrue(device.wait(Until.hasObject(By.text("创建")), 5000))
        device.findObject(By.text("创建")).click()
        assertTrue(device.wait(Until.hasObject(By.desc("原生书写画布")), 15000))
        lateinit var view: InkSurface
        activity.scenario.onActivity { view = requireNotNull(it.drawingSurface) }
        val records = stroke(view)
        assertEquals(1, records.size)
        instrumentation.waitForIdleSync()
        screenshot("native-editor.png")
    }

    private fun screenshot(name: String) {
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(instrumentation.targetContext.getExternalFilesDir(null), name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
