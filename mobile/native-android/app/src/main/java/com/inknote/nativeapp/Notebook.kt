package com.inknote.nativeapp

import androidx.ink.brush.Brush
import androidx.ink.brush.StockBrushes
import androidx.ink.strokes.Stroke
import java.util.UUID

enum class Tool { PEN, HIGHLIGHTER, ERASER, HAND }

fun makeBrush(kind: Tool, color: Int, size: Float): Brush = Brush.createWithColorIntArgb(
    family = if (kind == Tool.HIGHLIGHTER) StockBrushes.highlighter() else StockBrushes.pressurePen(),
    colorIntArgb = if (kind == Tool.HIGHLIGHTER) (color and 0xffffff) or 0x60000000 else color,
    size = size,
    epsilon = 0.1f,
)

data class InkRecord(val id: String = UUID.randomUUID().toString(), val kind: Tool, val stroke: Stroke)
data class NotePage(
    val id: String = UUID.randomUUID().toString(),
    val width: Float = 595.28f,
    val height: Float = 841.89f,
    val paper: String = "ruled",
    val strokes: List<InkRecord> = emptyList(),
    val pdfPage: Int? = null,
)
data class Notebook(
    val id: String = UUID.randomUUID().toString(),
    val title: String = "新的笔记",
    val updated: Long = System.currentTimeMillis(),
    val pages: List<NotePage> = listOf(NotePage()),
    val pdfFile: String? = null,
)

/** Immutable page snapshots: only completed strokes enter undo history or persistence. */
class PageHistory {
    private val undo = ArrayDeque<List<InkRecord>>()
    private val redo = ArrayDeque<List<InkRecord>>()
    fun record(before: List<InkRecord>) {
        undo.addLast(before)
        if (undo.size > 100) undo.removeFirst()
        redo.clear()
    }
    fun undo(current: List<InkRecord>): List<InkRecord>? = undo.removeLastOrNull()?.also { redo.addLast(current) }
    fun redo(current: List<InkRecord>): List<InkRecord>? = redo.removeLastOrNull()?.also { undo.addLast(current) }
    fun clear() { undo.clear(); redo.clear() }
}
