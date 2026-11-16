package com.inknote.nativeapp

import android.content.Context
import android.graphics.*
import android.os.SystemClock
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.FrameLayout
import androidx.ink.authoring.InProgressStrokeId
import androidx.ink.authoring.InProgressStrokesFinishedListener
import androidx.ink.authoring.InProgressStrokesView
import androidx.ink.strokes.Stroke
import androidx.ink.strokes.StrokeInput
import androidx.input.motionprediction.MotionEventPredictor
import kotlin.math.*

/** Native input/rendering island. Compose is notified on stroke completion, never per sample. */
class InkSurface(context: Context) : FrameLayout(context) {
    var tool = Tool.PEN
    var inkColor = Color.rgb(37, 32, 46)
    var nibSize = 2.2f
    var penOnly = true
    var predictionEnabled = true
    var onChange: (List<InkRecord>) -> Unit = {}
    var onReport: (String) -> Unit = {}
    private var page = NotePage()
    private var committed: List<InkRecord> = emptyList()
    private var paperBitmap: Bitmap? = null
    private val history = PageHistory()
    private val identity = Matrix()
    private val worldToView = Matrix()
    private val viewToWorld = Matrix()
    private val raster = HistoryRaster()
    private var historyTiles: List<HistoryTile> = emptyList()
    private var historyReady = false
    private var disposed = false
    private val waitingForHandoff = linkedSetOf<InProgressStrokeId>()
    private val content = object : View(context) {
        override fun onDraw(canvas: Canvas) {
            canvas.drawColor(0xffeee9f2.toInt())
            val save = canvas.save()
            canvas.concat(worldToView)
            canvas.clipRect(0f, 0f, page.width, page.height)
            paintPaper(canvas, page)
            paperBitmap?.let { canvas.drawBitmap(it, null, RectF(0f, 0f, page.width, page.height), bitmapPaint) }
            historyTiles.forEach { tile -> canvas.drawBitmap(tile.bitmap, null, tile.bounds, bitmapPaint) }
            canvas.restoreToCount(save)
        }
    }
    private val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val ink = InProgressStrokesView(context)
    private val predictor by lazy { MotionEventPredictor.newInstance(ink) }
    private var activeId: InProgressStrokeId? = null
    private var activePointer = -1
    private var activeToolType = MotionEvent.TOOL_TYPE_UNKNOWN
    private val pending = LinkedHashMap<InProgressStrokeId, Tool>()
    private var lastPen = 0L
    private var zoom = 1f
    private var offsetX = 0f
    private var offsetY = 0f
    private var fitted = false
    private var panning = false
    private var lastFocusX = 0f
    private var lastFocusY = 0f
    private var erasing = false
    private var eraseBefore: List<InkRecord>? = null
    private var erasePoint: PointF? = null
    private val scale = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val newZoom = (zoom * detector.scaleFactor).coerceIn(1f, 8f)
            val ratio = newZoom / zoom
            offsetX = detector.focusX - (detector.focusX - offsetX) * ratio
            offsetY = detector.focusY - (detector.focusY - offsetY) * ratio
            zoom = newZoom; updateTransform(); return true
        }
    })

    init {
        clipChildren = true
        addView(content, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(ink, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        contentDescription = "原生书写画布"
        ink.addFinishedStrokesListener(object : InProgressStrokesFinishedListener {
            override fun onStrokesFinished(strokes: Map<InProgressStrokeId, Stroke>) {
                if (disposed) return
                val added = pending.keys.filter { it in strokes }.map { id ->
                    InkRecord(kind = requireNotNull(pending.remove(id)), stroke = requireNotNull(strokes[id]))
                }
                if (added.isNotEmpty()) {
                    added.forEach { record -> history.record(committed); committed = committed + record }
                    waitingForHandoff.addAll(strokes.keys)
                    rebuildHistory()
                    onChange(committed)
                    onReport("当前 ${committed.size} 笔 · 最近一笔 ${added.last().stroke.inputs.size} 个真实采样点")
                }
                if (added.isEmpty()) ink.removeFinishedStrokes(strokes.keys)
            }
        })
        ink.eagerInit()
    }

    val hasPendingInput get() = activeId != null || pending.isNotEmpty() || waitingForHandoff.isNotEmpty() || erasing
    val strokeCount get() = committed.size

    fun showPage(value: NotePage) {
        if (value.id == page.id && value.strokes == committed && value.paper == page.paper) return
        if (value.id != page.id) {
            cancelInput(); history.clear(); historyTiles = emptyList(); paperBitmap = null; fitted = false
            if (waitingForHandoff.isNotEmpty()) { ink.removeFinishedStrokes(waitingForHandoff.toSet()); waitingForHandoff.clear() }
        }
        page = value; committed = value.strokes
        rebuildHistory()
        if (!fitted && width > 0 && height > 0) fitPage() else content.invalidate()
    }

    fun showPdf(bitmap: Bitmap?) { if (paperBitmap !== bitmap) { paperBitmap = bitmap; content.invalidate() } }
    fun undo() { if (!hasPendingInput) history.undo(committed)?.let(::replaceStrokes) }
    fun redo() { if (!hasPendingInput) history.redo(committed)?.let(::replaceStrokes) }
    fun clearPage() { if (!hasPendingInput && committed.isNotEmpty()) { history.record(committed); replaceStrokes(emptyList()) } }
    private fun replaceStrokes(value: List<InkRecord>) {
        committed = value
        rebuildHistory(); onChange(value)
    }
    fun fitPage() {
        if (hasPendingInput || width == 0 || height == 0) return
        zoom = 1f
        val s = baseScale()
        offsetX = (width - page.width * s) / 2
        offsetY = (height - page.height * s) / 2
        fitted = true; updateTransform()
    }
    private fun baseScale() = min(width / page.width, height / page.height) * .94f
    private fun updateTransform() {
        val s = baseScale() * zoom
        worldToView.setValues(floatArrayOf(s, 0f, offsetX, 0f, s, offsetY, 0f, 0f, 1f))
        worldToView.invert(viewToWorld)
        val paperBounds = RectF(0f, 0f, page.width, page.height)
        worldToView.mapRect(paperBounds)
        // Ink's maskPath excludes ink. Exclude the area OUTSIDE the paper, leaving a hole inside it.
        ink.maskPath = Path().apply {
            fillType = Path.FillType.EVEN_ODD
            addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
            addRect(paperBounds, Path.Direction.CW)
        }
        content.invalidate()
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); fitted = false; fitPage() }
    override fun onInterceptTouchEvent(event: MotionEvent) = true
    override fun onHoverEvent(event: MotionEvent): Boolean {
        if (event.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) lastPen = SystemClock.uptimeMillis()
        return super.onHoverEvent(event)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_CANCEL) {
            predictor.record(event); cancelInput(event); return true
        }
        val actionIndex = event.actionIndex
        if (event.flags and MotionEvent.FLAG_CANCELED != 0) {
            predictor.record(event)
            if (event.getPointerId(actionIndex) == activePointer) cancelInput(event)
            return true
        }
        val actionType = event.getToolType(actionIndex)
        val stylusAction = actionType == MotionEvent.TOOL_TYPE_STYLUS || actionType == MotionEvent.TOOL_TYPE_ERASER
        if (stylusAction) lastPen = SystemClock.uptimeMillis()
        predictor.record(event)
        if (activeId != null || erasing) {
            val index = event.findPointerIndex(activePointer)
            val isPen = activeToolType == MotionEvent.TOOL_TYPE_STYLUS || activeToolType == MotionEvent.TOOL_TYPE_ERASER
            if (!isPen && event.actionMasked == MotionEvent.ACTION_POINTER_DOWN) {
                cancelInput(event)
                startPan(event)
                return true
            }
            if (index < 0) { cancelInput(event); return true }
            if (event.actionMasked == MotionEvent.ACTION_MOVE) {
                if (erasing) eraseTo(event, index) else {
                    val prediction = if (predictionEnabled) predictor.predict() else null
                    try { ink.addToStroke(event, activePointer, requireNotNull(activeId), prediction) }
                    finally { prediction?.recycle() }
                }
            }
            if ((event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_POINTER_UP) &&
                event.getPointerId(actionIndex) == activePointer) {
                if (erasing) {
                    eraseTo(event, index)
                    eraseBefore?.let { before -> if (before != committed) { history.record(before); onChange(committed) } }
                    erasing = false; eraseBefore = null; erasePoint = null
                } else ink.finishStroke(event, activePointer, requireNotNull(activeId))
                activeId = null; activePointer = -1
                performClick()
            }
            // Fingers and palms never cancel an active stylus stroke merely by touching the page.
            return true
        }
        if (tool == Tool.HAND) { pan(event); return true }
        if ((event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_POINTER_DOWN) && stylusAction) {
            panning = false; beginInk(event, actionIndex, actionType); return true
        }
        if (SystemClock.uptimeMillis() - lastPen < 250L) return true
        if (event.actionMasked == MotionEvent.ACTION_DOWN && !penOnly && tool != Tool.HAND) {
            beginInk(event, actionIndex, actionType); return true
        }
        pan(event)
        return true
    }

    private fun beginInk(event: MotionEvent, index: Int, type: Int) {
        val q = worldPoint(event, index)
        if (q.x !in 0f..page.width || q.y !in 0f..page.height || tool == Tool.HAND) { startPan(event); return }
        requestUnbufferedDispatch(event)
        parent?.requestDisallowInterceptTouchEvent(true)
        activePointer = event.getPointerId(index); activeToolType = type
        if (tool == Tool.ERASER || type == MotionEvent.TOOL_TYPE_ERASER) {
            erasing = true; eraseBefore = committed; erasePoint = q; eraseTo(event, index)
        } else {
            val brush = makeBrush(tool, inkColor, if (tool == Tool.HIGHLIGHTER) nibSize * 5 else nibSize)
            activeId = ink.startStroke(event, activePointer, brush, Matrix(viewToWorld), identity)
            pending[requireNotNull(activeId)] = tool
        }
    }

    private fun cancelInput(event: MotionEvent? = null) {
        activeId?.let { ink.cancelStroke(it, event); pending.remove(it) }
        activeId = null; activePointer = -1
        if (erasing) eraseBefore?.let { committed = it; rebuildHistory() }
        erasing = false; eraseBefore = null; erasePoint = null; panning = false
    }
    private fun focus(event: MotionEvent): PointF {
        var x = 0f; var y = 0f; var n = 0
        for (i in 0 until event.pointerCount) {
            if (event.actionMasked == MotionEvent.ACTION_POINTER_UP && i == event.actionIndex) continue
            x += event.getX(i); y += event.getY(i); n++
        }
        return PointF(x / max(1, n), y / max(1, n))
    }
    private fun startPan(event: MotionEvent) {
        val f = focus(event); lastFocusX = f.x; lastFocusY = f.y; panning = true
        scale.onTouchEvent(event)
    }
    private fun pan(event: MotionEvent) {
        scale.onTouchEvent(event)
        val f = focus(event)
        if (event.actionMasked == MotionEvent.ACTION_MOVE && panning) {
            offsetX += f.x - lastFocusX; offsetY += f.y - lastFocusY; updateTransform()
        }
        lastFocusX = f.x; lastFocusY = f.y
        if (event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_POINTER_DOWN) panning = true
        if (event.actionMasked == MotionEvent.ACTION_UP) panning = false
    }
    private fun worldPoint(event: MotionEvent, index: Int): PointF {
        val q = floatArrayOf(event.getX(index), event.getY(index)); viewToWorld.mapPoints(q); return PointF(q[0], q[1])
    }
    private fun eraseTo(event: MotionEvent, index: Int) {
        val to = worldPoint(event, index); val from = erasePoint ?: to
        val radius = 14f / (baseScale() * zoom)
        val next = committed.filterNot { intersectsStroke(it, from, to, radius) }
        if (next.size != committed.size) { committed = next; rebuildHistory() }
        erasePoint = to
    }
    override fun performClick(): Boolean { super.performClick(); return true }
    private fun rebuildHistory() {
        if (disposed) return
        historyReady = false
        raster.request(page, committed) { tiles ->
            historyTiles = tiles
            historyReady = true
            content.invalidate()
            completeHandoffIfVisible()
            if (!fitted) fitPage()
        }
    }
    private fun completeHandoffIfVisible() {
        if (historyReady && waitingForHandoff.isNotEmpty() && windowVisibility == View.VISIBLE && isAttachedToWindow) {
            content.invalidate()
            ink.removeFinishedStrokes(waitingForHandoff.toSet())
            waitingForHandoff.clear()
        }
    }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == View.VISIBLE) post { completeHandoffIfVisible() }
    }
    override fun onDetachedFromWindow() {
        disposed = true
        ink.clearFinishedStrokesListeners()
        cancelInput()
        raster.close()
        super.onDetachedFromWindow()
    }
}

/** Eraser tests the swept segment, including fast eraser moves between delivered samples. */
internal fun intersectsStroke(record: InkRecord, from: PointF, to: PointF, radius: Float): Boolean {
    val inputs = record.stroke.inputs
    val previous = StrokeInput(); val current = StrokeInput()
    inputs.populate(0, previous)
    for (i in 0 until inputs.size) {
        inputs.populate(i, current)
        if (segmentDistance(from.x, from.y, to.x, to.y, previous.x, previous.y, current.x, current.y) <= radius + record.stroke.brush.size / 2) return true
        previous.update(current.x, current.y, current.elapsedTimeMillis)
    }
    return false
}

internal fun segmentDistance(ax: Float, ay: Float, bx: Float, by: Float, cx: Float, cy: Float, dx: Float, dy: Float): Float {
    fun cross(px: Float, py: Float, qx: Float, qy: Float) = px * qy - py * qx
    val abx = bx - ax; val aby = by - ay; val cdx = dx - cx; val cdy = dy - cy
    val denominator = cross(abx, aby, cdx, cdy)
    if (abs(denominator) > .000001f) {
        val t = cross(cx - ax, cy - ay, cdx, cdy) / denominator
        val u = cross(cx - ax, cy - ay, abx, aby) / denominator
        if (t in 0f..1f && u in 0f..1f) return 0f
    }
    fun distance(px: Float, py: Float, sx: Float, sy: Float, ex: Float, ey: Float): Float {
        val vx = ex - sx; val vy = ey - sy; val length = vx * vx + vy * vy
        val t = if (length == 0f) 0f else (((px - sx) * vx + (py - sy) * vy) / length).coerceIn(0f, 1f)
        return hypot(px - sx - t * vx, py - sy - t * vy)
    }
    return minOf(distance(ax, ay, cx, cy, dx, dy), distance(bx, by, cx, cy, dx, dy), distance(cx, cy, ax, ay, bx, by), distance(dx, dy, ax, ay, bx, by))
}
