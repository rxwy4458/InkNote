package com.inknote.nativeapp

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import androidx.ink.rendering.android.canvas.CanvasStrokeRenderer
import androidx.ink.strokes.StrokeInput
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.*

internal data class HistoryTile(val bitmap: Bitmap, val bounds: RectF)

/**
 * Finished ink is rasterized off the UI thread. Tiles are immutable after publication: appending
 * a stroke copies only the tiles it touches. No UI-thread mesh construction or manual in-flight
 * RenderNode destruction is needed, including when a dense page closes immediately after inking.
 */
internal class HistoryRaster {
    private val main = Handler(Looper.getMainLooper())
    private val epoch = AtomicInteger()
    private val worker = Executors.newSingleThreadExecutor { task ->
        Thread({ android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); task.run() }, "InkNote-history")
    }
    private var previousPage = ""
    private var previousRecords: List<InkRecord> = emptyList()
    private var previousTiles: Map<Pair<Int, Int>, HistoryTile> = emptyMap()

    fun request(page: NotePage, records: List<InkRecord>, ready: (List<HistoryTile>) -> Unit) {
        val token = epoch.incrementAndGet()
        worker.execute {
            if (epoch.get() != token) return@execute
            val append = previousPage == page.id && previousRecords.size <= records.size &&
                previousRecords.indices.all { records[it] === previousRecords[it] }
            val tiles = if (append) previousTiles.toMutableMap() else mutableMapOf()
            val delta = if (append) records.drop(previousRecords.size) else records
            val scale = min(4f, 3072f / max(page.width, page.height))
            // Integer pixel boundaries keep adjacent cached tiles aligned under filtering.
            val tileSize = 768f / scale
            val buckets = LinkedHashMap<Pair<Int, Int>, MutableList<InkRecord>>()
            val input = StrokeInput()
            for (record in delta) {
                if (epoch.get() != token) return@execute
                var left = Float.POSITIVE_INFINITY; var top = Float.POSITIVE_INFINITY
                var right = Float.NEGATIVE_INFINITY; var bottom = Float.NEGATIVE_INFINITY
                for (i in 0 until record.stroke.inputs.size) {
                    record.stroke.inputs.populate(i, input)
                    left = min(left, input.x); top = min(top, input.y)
                    right = max(right, input.x); bottom = max(bottom, input.y)
                }
                val pad = record.stroke.brush.size * 2
                val minX = floor((left - pad) / tileSize).toInt().coerceAtLeast(0)
                val minY = floor((top - pad) / tileSize).toInt().coerceAtLeast(0)
                val maxX = floor((right + pad) / tileSize).toInt().coerceAtMost(ceil(page.width / tileSize).toInt() - 1)
                val maxY = floor((bottom + pad) / tileSize).toInt().coerceAtMost(ceil(page.height / tileSize).toInt() - 1)
                for (y in minY..maxY) for (x in minX..maxX) buckets.getOrPut(x to y) { mutableListOf() }.add(record)
            }
            val renderer = CanvasStrokeRenderer.create()
            for ((key, additions) in buckets) {
                if (epoch.get() != token) return@execute
                val left = key.first * tileSize; val top = key.second * tileSize
                val w = min(tileSize, page.width - left); val h = min(tileSize, page.height - top)
                val bitmap = tiles[key]?.bitmap?.copy(Bitmap.Config.ARGB_8888, true)
                    ?: Bitmap.createBitmap(ceil(w * scale).toInt(), ceil(h * scale).toInt(), Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                val transform = Matrix().apply { setValues(floatArrayOf(scale, 0f, -left * scale, 0f, scale, -top * scale, 0f, 0f, 1f)) }
                canvas.concat(transform)
                additions.forEach { renderer.draw(canvas, it.stroke, transform) }
                tiles[key] = HistoryTile(bitmap, RectF(left, top, left + bitmap.width / scale, top + bitmap.height / scale))
            }
            if (epoch.get() != token) return@execute
            previousPage = page.id; previousRecords = records; previousTiles = tiles.toMap()
            val published = previousTiles.values.toList()
            main.post { if (epoch.get() == token) ready(published) }
        }
    }

    fun close() { epoch.incrementAndGet(); worker.shutdown() }
}
