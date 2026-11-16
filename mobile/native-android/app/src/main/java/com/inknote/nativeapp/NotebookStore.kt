package com.inknote.nativeapp

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.AtomicFile
import android.util.Base64
import androidx.ink.rendering.android.canvas.CanvasStrokeRenderer
import androidx.ink.storage.StrokeInputBatchSerialization
import androidx.ink.strokes.Stroke
import org.json.JSONArray
import org.json.JSONObject
import java.io.*
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** All methods run on the caller's IO executor, never in a MotionEvent callback. */
class NotebookStore(val root: File) {
    init { root.mkdirs() }
    fun load(): Pair<List<Notebook>, Int> {
        var failed = 0
        val notes = root.listFiles().orEmpty().filter { it.extension == "json" }.mapNotNull { file ->
            try { decode(AtomicFile(file).openRead().use { it.readBytes() }.toString(Charsets.UTF_8)) }
            catch (_: Exception) { failed++; null }
        }
        return notes.sortedByDescending { it.updated } to failed
    }

    fun save(note: Notebook) {
        val file = AtomicFile(File(root, "${note.id}.json"))
        val out = file.startWrite()
        try { out.write(encode(note).toByteArray()); file.finishWrite(out) }
        catch (error: Exception) { file.failWrite(out); throw error }
    }

    fun encode(note: Notebook): String = JSONObject().apply {
        put("format", "inknote-native-preview"); put("version", 1)
        put("id", note.id); put("title", note.title); put("updated", note.updated)
        note.pdfFile?.let { put("pdfFile", it) }
        put("pages", JSONArray().apply { note.pages.forEach { page -> put(JSONObject().apply {
            put("id", page.id); put("width", page.width.toDouble()); put("height", page.height.toDouble())
            put("paper", page.paper); page.pdfPage?.let { put("pdfPage", it) }
            put("strokes", JSONArray().apply { page.strokes.forEach { record -> put(JSONObject().apply {
                put("id", record.id); put("kind", record.kind.name)
                put("color", record.stroke.brush.colorIntArgb); put("size", record.stroke.brush.size.toDouble())
                val bytes = ByteArrayOutputStream().also { StrokeInputBatchSerialization.encode(record.stroke.inputs, it) }.toByteArray()
                put("inputs", Base64.encodeToString(bytes, Base64.NO_WRAP))
            }) } })
        }) } })
    }.toString()

    fun decode(text: String): Notebook {
        require(text.length <= 32 * 1024 * 1024) { "备份超过测试版的 32 MB 限制" }
        val obj = JSONObject(text)
        require(obj.optString("format") == "inknote-native-preview" && obj.getInt("version") == 1) { "请选择原生试写版导出的 .inknative 备份" }
        val pages = obj.getJSONArray("pages")
        require(pages.length() in 1..1000) { "页面数量无效" }
        var totalStrokes = 0
        var totalInputs = 0
        val result = Notebook(
            id = UUID.fromString(obj.getString("id")).toString(),
            title = obj.getString("title").take(200), updated = obj.getLong("updated"),
            pdfFile = obj.optString("pdfFile").takeIf { it.matches(Regex("[a-fA-F0-9-]{36}\\.pdf")) },
            pages = (0 until pages.length()).map { i ->
                val p = pages.getJSONObject(i)
                val w = p.getDouble("width").toFloat(); val h = p.getDouble("height").toFloat()
                require(w.isFinite() && h.isFinite() && w in 1f..10000f && h in 1f..10000f) { "页面尺寸无效" }
                val entries = p.getJSONArray("strokes")
                totalStrokes += entries.length(); require(totalStrokes <= 20000) { "笔迹数量超过测试版限制" }
                NotePage(id = p.getString("id"), width = w, height = h, paper = p.optString("paper", "ruled"),
                    pdfPage = if (p.has("pdfPage")) p.getInt("pdfPage").also { require(it in 0..999) } else null,
                    strokes = (0 until entries.length()).map { j ->
                        val e = entries.getJSONObject(j)
                        val kind = Tool.valueOf(e.getString("kind"))
                        require(kind == Tool.PEN || kind == Tool.HIGHLIGHTER)
                        val size = e.getDouble("size").toFloat(); require(size.isFinite() && size in .1f..100f)
                        val data = Base64.decode(e.getString("inputs"), Base64.DEFAULT)
                        val inputs = StrokeInputBatchSerialization.decode(ByteArrayInputStream(data))
                        totalInputs += inputs.size; require(totalInputs <= 2_000_000) { "笔迹采样点过多" }
                        require(inputs.size > 0)
                        InkRecord(e.getString("id"), kind, Stroke(makeBrush(kind, e.getInt("color"), size), inputs))
                    })
            })
        require(result.pdfFile != null || result.pages.all { it.pdfPage == null }) { "PDF 原文件缺失" }
        return result
    }

    fun importPdf(input: InputStream, title: String): Notebook {
        val id = UUID.randomUUID().toString(); val file = File(root, "$id.pdf")
        try {
            input.use { source -> file.outputStream().use { copyBounded(source, it, 100L * 1024 * 1024) } }
            val pages = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
                PdfRenderer(fd).use { pdf ->
                    require(pdf.pageCount in 1..1000) { "PDF 超过测试版的 1000 页限制" }
                    (0 until pdf.pageCount).map { i -> pdf.openPage(i).use {
                        require(it.width in 1..10000 && it.height in 1..10000) { "PDF 页面尺寸超过测试版限制" }
                        NotePage(width = it.width.toFloat(), height = it.height.toFloat(), paper = "blank", pdfPage = i)
                    } }
                }
            }
            return Notebook(id, title.take(200), pages = pages, pdfFile = file.name).also(::save)
        } catch (error: Exception) { file.delete(); throw error }
    }

    fun pdfBitmap(note: Notebook, page: NotePage, targetWidth: Int = 2048): Bitmap? {
        val index = page.pdfPage ?: return null
        return ParcelFileDescriptor.open(File(root, requireNotNull(note.pdfFile)), ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { pdf -> pdf.openPage(index).use { source ->
                val scale = minOf(targetWidth.coerceIn(256, 2048).toFloat() / source.width, 4096f / source.height)
                val width = (source.width * scale).toInt().coerceAtLeast(1)
                val height = (source.height * scale).toInt().coerceAtLeast(1)
                Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
                    it.eraseColor(Color.WHITE)
                    source.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            } }
        }
    }

    fun exportBackup(note: Notebook, output: OutputStream) = ZipOutputStream(output).use { zip ->
        fun entry(name: String, writer: (OutputStream) -> Unit) { zip.putNextEntry(ZipEntry(name)); writer(zip); zip.closeEntry() }
        entry("notebook.json") { it.write(encode(note).toByteArray()) }
        note.pdfFile?.let { name -> entry("original.pdf") { out -> File(root, name).inputStream().use { it.copyTo(out) } } }
    }

    fun importBackup(input: InputStream): Notebook {
        val id = UUID.randomUUID().toString(); val stagedPdf = File(root, "$id.pdf")
        var text: String? = null; var hasPdf = false; var total = 0L
        try {
            ZipInputStream(input).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    require(entry.name == "notebook.json" || entry.name == "original.pdf") { "不支持的备份文件结构" }
                    if (entry.name == "notebook.json") {
                        require(text == null); val bytes = ByteArrayOutputStream()
                        total += copyBounded(zip, bytes, 32L * 1024 * 1024); text = bytes.toString("UTF-8")
                    } else {
                        require(!hasPdf); stagedPdf.outputStream().use { total += copyBounded(zip, it, 100L * 1024 * 1024) }; hasPdf = true
                    }
                    require(total < 132L * 1024 * 1024); entry = zip.nextEntry
                }
            }
            val note = decode(requireNotNull(text) { "备份中没有笔记数据" })
            require((note.pdfFile != null) == hasPdf) { "PDF 原文件缺失" }
            val imported = note.copy(id = id, updated = System.currentTimeMillis(), pdfFile = if (hasPdf) stagedPdf.name else null)
            if (hasPdf) {
                ParcelFileDescriptor.open(stagedPdf, ParcelFileDescriptor.MODE_READ_ONLY).use { fd -> PdfRenderer(fd).use { pdf ->
                    require(imported.pages.all { it.pdfPage == null || it.pdfPage < pdf.pageCount }) { "PDF 页码无效" }
                } }
            }
            save(imported); return imported
        } catch (error: Exception) { stagedPdf.delete(); throw error }
    }

    fun exportPdf(note: Notebook, output: OutputStream) {
        val renderer = CanvasStrokeRenderer.create()
        val document = PdfDocument()
        try {
            note.pages.forEachIndexed { index, page ->
                val pdfPage = document.startPage(PdfDocument.PageInfo.Builder(page.width.toInt().coerceAtLeast(1), page.height.toInt().coerceAtLeast(1), index + 1).create())
                try {
                    paintPaper(pdfPage.canvas, page)
                    pdfBitmap(note, page)?.let { bitmap ->
                        pdfPage.canvas.drawBitmap(bitmap, null, android.graphics.RectF(0f, 0f, page.width, page.height), Paint(Paint.FILTER_BITMAP_FLAG))
                        bitmap.recycle()
                    }
                    page.strokes.forEach { renderer.draw(pdfPage.canvas, it.stroke, Matrix()) }
                } finally {
                    document.finishPage(pdfPage)
                }
            }
            document.writeTo(output)
        } finally { document.close() }
    }

    private fun copyBounded(input: InputStream, output: OutputStream, max: Long): Long {
        val buffer = ByteArray(65536); var total = 0L
        while (true) { val n = input.read(buffer); if (n < 0) break; total += n; require(total <= max) { "文件超过测试版大小限制" }; output.write(buffer, 0, n) }
        return total
    }
}

fun paintPaper(canvas: Canvas, page: NotePage) {
    canvas.drawColor(Color.WHITE)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffe8e3ee.toInt(); strokeWidth = .6f }
    if (page.paper == "ruled") { var y = 48f; while (y < page.height) { canvas.drawLine(24f, y, page.width - 24f, y, paint); y += 24f } }
    if (page.paper == "dots") { var y = 32f; while (y < page.height) { var x = 24f; while (x < page.width) { canvas.drawCircle(x, y, .8f, paint); x += 20f }; y += 20f } }
}
