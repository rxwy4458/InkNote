package com.inknote.nativeapp

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap

class NoteModel(application: Application) : AndroidViewModel(application) {
    val store = NotebookStore(File(application.filesDir, "native-notebooks"))
    private fun worker(name: String) = Executors.newSingleThreadExecutor { runnable ->
        Thread({ android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); runnable.run() }, name)
    }
    private val io = worker("InkNote-save")
    private val pdf = worker("InkNote-pdf")
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    val notes = mutableStateListOf<Notebook>()
    var loading by mutableStateOf(true)
    var selectedId by mutableStateOf<String?>(null)
    var pageIndex by mutableIntStateOf(0)
    var message by mutableStateOf<String?>(null)
    var saveState by mutableStateOf("本机保存")
    var pdfBitmap by mutableStateOf<Bitmap?>(null)
        private set
    var pdfLoading by mutableStateOf(false)
        private set
    private var pdfEpoch = 0
    private var revision = 0L
    private val latestSaves = ConcurrentHashMap<String, Long>()
    var pendingExport: Notebook? = null
    val current get() = notes.find { it.id == selectedId }

    init {
        task({ store.load() }) { (list, failed) ->
            notes.addAll(list); loading = false
            if (failed > 0) message = "$failed 本笔记读取失败，原文件已保留"
        }
    }

    fun create(title: String, paper: String) {
        val note = Notebook(title = title.ifBlank { "新的笔记" }, pages = listOf(NotePage(paper = paper)))
        notes.add(0, note); persist(note); open(note.id)
    }
    fun open(id: String) { selectedId = id; pageIndex = 0; requestPdf() }
    fun close() { selectedId = null; clearPdf() }
    fun turnPage(index: Int) {
        val note = current ?: return
        pageIndex = index.coerceIn(0, note.pages.lastIndex); requestPdf()
    }
    fun addPage() {
        val note = current ?: return
        val next = note.copy(updated = System.currentTimeMillis(), pages = note.pages + NotePage(paper = note.pages[pageIndex].paper))
        update(next); pageIndex = next.pages.lastIndex; requestPdf()
    }
    fun setStrokes(pageId: String, strokes: List<InkRecord>) {
        val note = current ?: return
        val strokeCount = note.pages.sumOf { if (it.id == pageId) strokes.size else it.strokes.size }
        val sampleCount = note.pages.sumOf { p -> (if (p.id == pageId) strokes else p.strokes).sumOf { it.stroke.inputs.size.toLong() } }
        if (strokeCount > 20000 || sampleCount > 2_000_000) {
            message = "当前笔记达到测试版容量限制，请新建一本笔记继续书写"
            return
        }
        update(note.copy(updated = System.currentTimeMillis(), pages = note.pages.map { if (it.id == pageId) it.copy(strokes = strokes) else it }))
    }
    fun rename(title: String) { current?.let { update(it.copy(title = title.take(200), updated = System.currentTimeMillis())) } }
    private fun update(note: Notebook) {
        val index = notes.indexOfFirst { it.id == note.id }; if (index >= 0) notes[index] = note
        persist(note)
    }
    private fun persist(note: Notebook) {
        val savedRevision = ++revision; saveState = "正在保存…"
        latestSaves[note.id] = savedRevision
        // Superseded snapshots are skipped instead of accumulating expensive full-note writes.
        task({ if (latestSaves[note.id] == savedRevision) store.save(note) }) {
            if (savedRevision == revision) saveState = "已保存到本机"
        }
    }
    private fun clearPdf() { pdfEpoch++; pdfBitmap = null; pdfLoading = false }
    fun requestPdf() {
        val note = current ?: return
        val page = note.pages[pageIndex]; val epoch = ++pdfEpoch
        pdfBitmap = null; pdfLoading = page.pdfPage != null
        if (page.pdfPage == null) return
        pdf.execute {
            try {
                val bitmap = store.pdfBitmap(note, page)
                main.post { if (pdfEpoch == epoch) { pdfBitmap = bitmap; pdfLoading = false } else bitmap?.recycle() }
            } catch (error: Exception) { main.post { if (pdfEpoch == epoch) { pdfLoading = false; message = "PDF 页面读取失败：${error.message}" } } }
        }
    }
    fun importPdf(uri: Uri) {
        val resolver = getApplication<Application>().contentResolver
        val title = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0).substringBeforeLast('.') else "导入的 PDF"
        } ?: "导入的 PDF"
        message = "正在导入 PDF…"
        task({ store.importPdf(requireNotNull(resolver.openInputStream(uri)), title) }) { notes.add(0, it); open(it.id); message = "PDF 已导入" }
    }
    fun importBackup(uri: Uri) {
        task({ store.importBackup(requireNotNull(getApplication<Application>().contentResolver.openInputStream(uri))) }) {
            notes.add(0, it); open(it.id); message = "原生备份已恢复"
        }
    }
    fun export(uri: Uri, backup: Boolean) {
        val note = pendingExport ?: return
        pendingExport = null
        task({
            requireNotNull(getApplication<Application>().contentResolver.openOutputStream(uri)).use {
                if (backup) store.exportBackup(note, it) else store.exportPdf(note, it)
            }
        }) { message = if (backup) "可编辑备份已导出" else "PDF 已导出" }
    }
    private fun <T> task(work: () -> T, done: (T) -> Unit) {
        io.execute {
            try { val result = work(); main.post { done(result) } }
            catch (error: Exception) { main.post { loading = false; saveState = "操作失败"; message = error.message ?: "无法完成操作" } }
        }
    }
    override fun onCleared() { io.shutdown(); pdf.shutdown() }
}
