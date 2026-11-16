package com.inknote.nativeapp

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    var drawingSurface: InkSurface? = null
        internal set
    var highRefresh = true
        private set
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        applyRefreshMode(true)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(
                primary = Color(0xff66568b), onPrimary = Color.White,
                primaryContainer = Color(0xffe9defa), secondaryContainer = Color(0xfff5bfe2),
                surface = Color(0xfffff8ff), background = Color(0xfffff8ff),
            )) { NativeApp(this) }
        }
    }
    fun applyRefreshMode(enabled: Boolean) {
        highRefresh = enabled
        val d = display ?: return
        val current = d.mode
        val best = d.supportedModes.filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
            .maxByOrNull { it.refreshRate } ?: current
        window.attributes = window.attributes.apply {
            preferredDisplayModeId = if (enabled) best.modeId else 0
            preferredRefreshRate = if (enabled) best.refreshRate else 0f
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun NativeApp(activity: MainActivity, model: NoteModel = viewModel()) {
    var showNew by remember { mutableStateOf(false) }
    var newTitle by remember { mutableStateOf("") }
    var newPaper by remember { mutableStateOf("ruled") }
    var settings by rememberSaveable { mutableStateOf(false) }
    var tool by rememberSaveable { mutableStateOf(Tool.PEN) }
    var penOnly by rememberSaveable { mutableStateOf(true) }
    var prediction by rememberSaveable { mutableStateOf(true) }
    var inkColor by rememberSaveable { mutableIntStateOf(0xff25202e.toInt()) }
    var nibSize by rememberSaveable { mutableFloatStateOf(2.2f) }
    var report by remember { mutableStateOf("使用手写笔落笔；手指移动页面，两指缩放") }
    var confirmClear by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var renamedTitle by remember { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }
    val snackbar = remember { SnackbarHostState() }
    val note = model.current
    val page = note?.pages?.getOrNull(model.pageIndex)
    val importPdf = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(model::importPdf) }
    val importBackup = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(model::importBackup) }
    val exportPdf = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { it?.let { uri -> model.export(uri, false) } }
    val exportBackup = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { it?.let { uri -> model.export(uri, true) } }
    fun whenIdle(block: () -> Unit) {
        if (activity.drawingSurface?.hasPendingInput == true) model.message = "请抬笔，等这一笔完成后再操作" else block()
    }
    LaunchedEffect(model.message) { model.message?.let { text -> model.message = null; snackbar.showSnackbar(text) } }
    DisposableEffect(note?.id) {
        if (note != null) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }
    BackHandler(note != null) { whenIdle { model.close() } }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, containerColor = MaterialTheme.colorScheme.background) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (note == null) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("墨页", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(12.dp)); Text("原生试写", style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.weight(1f)); TextButton(onClick = { settings = true }) { Text("设置") }
                }
                OutlinedTextField(search, { search = it }, Modifier.fillMaxWidth().padding(horizontal = 24.dp), placeholder = { Text("搜索笔记标题") }, singleLine = true, shape = CircleShape)
                LazyVerticalGrid(GridCells.Adaptive(240.dp), Modifier.weight(1f).padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(vertical = 24.dp)) {
                    item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                        Column {
                            Text(SimpleDateFormat("M月d日 EEEE", Locale.CHINA).format(Date()), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("把想法，写下来。", Modifier.padding(top = 8.dp, bottom = 16.dp), fontSize = 36.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { newTitle = "新的笔记"; showNew = true }) { Text("新建画布") }
                                FilledTonalButton(onClick = { importPdf.launch(arrayOf("application/pdf")) }) { Text("导入 PDF") }
                                OutlinedButton(onClick = { importBackup.launch(arrayOf("application/octet-stream", "application/zip")) }) { Text("恢复原生备份") }
                            }
                            Text("先体验原生书写、压感和 PDF 批注。完整版界面与旧笔记迁移在后续接入。", Modifier.padding(top = 16.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (model.loading) item { CircularProgressIndicator() }
                    items(model.notes.filter { it.title.contains(search, true) }, key = { it.id }) { item ->
                        Card(onClick = { model.open(item.id) }, shape = RoundedCornerShape(28.dp), colors = CardDefaults.cardColors(containerColor = Color(0xfff0eaf5))) {
                            Column(Modifier.padding(20.dp).heightIn(min = 170.dp)) {
                                Surface(shape = RoundedCornerShape(20.dp), color = if (item.pdfFile == null) Color(0xffded4ef) else Color(0xffd4e8dd), modifier = Modifier.fillMaxWidth().height(76.dp)) {
                                    Box(contentAlignment = Alignment.Center) { Text(if (item.pdfFile == null) "手写画布" else "PDF 批注", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium) }
                                }
                                Text(item.title, Modifier.padding(top = 16.dp), maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                                Text("${item.pages.size} 页 · ${item.pages.sumOf { it.strokes.size }} 笔", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            } else if (page != null) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { whenIdle { model.close() } }) { Text("返回") }
                    Column(Modifier.weight(1f).clickable { renamedTitle = note.title; rename = true }) {
                        Text(note.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                        Text(model.saveState, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton(onClick = { activity.drawingSurface?.undo() }) { Text("撤销") }
                    TextButton(onClick = { activity.drawingSurface?.redo() }) { Text("重做") }
                    TextButton(onClick = { settings = true }) { Text("更多") }
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { whenIdle { model.turnPage(model.pageIndex - 1) } }, enabled = model.pageIndex > 0) { Text("上一页") }
                    Text("${model.pageIndex + 1} / ${note.pages.size}", style = MaterialTheme.typography.labelLarge)
                    TextButton(onClick = { whenIdle { model.turnPage(model.pageIndex + 1) } }, enabled = model.pageIndex < note.pages.lastIndex) { Text("下一页") }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { whenIdle { model.addPage() } }) { Text("加页") }
                    TextButton(onClick = { activity.drawingSurface?.fitPage() }) { Text("适合页面") }
                }
                Box(Modifier.fillMaxWidth().weight(1f)) {
                    AndroidView(
                        factory = { context -> InkSurface(context).also { activity.drawingSurface = it } },
                        modifier = Modifier.fillMaxSize(),
                        onRelease = { activity.drawingSurface = null },
                        update = { surface ->
                            surface.tool = tool; surface.penOnly = penOnly; surface.predictionEnabled = prediction
                            surface.inkColor = inkColor; surface.nibSize = nibSize
                            surface.onChange = { model.setStrokes(page.id, it) }
                            surface.onReport = { report = it }
                            surface.showPage(page); surface.showPdf(model.pdfBitmap)
                        },
                    )
                    if (model.pdfLoading) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
                    Surface(Modifier.align(Alignment.BottomCenter).padding(12.dp), shape = RoundedCornerShape(32.dp), color = MaterialTheme.colorScheme.primaryContainer, shadowElevation = 6.dp) {
                        FlowRow(Modifier.padding(horizontal = 12.dp, vertical = 6.dp).widthIn(max = 680.dp), horizontalArrangement = Arrangement.Center, verticalArrangement = Arrangement.Center) {
                            listOf(Tool.PEN to "画笔", Tool.HIGHLIGHTER to "荧光", Tool.ERASER to "整笔擦", Tool.HAND to "移动").forEach { (value, label) ->
                                FilterChip(selected = tool == value, onClick = { tool = value }, label = { Text(label) }, modifier = Modifier.padding(horizontal = 3.dp))
                            }
                            listOf(0xff25202e, 0xff1a73e8, 0xffd93025, 0xff188038, 0xff9334e6).forEach { color ->
                                val chosen = color.toInt() == inkColor
                                Box(Modifier.padding(5.dp).size(36.dp).background(if (chosen) MaterialTheme.colorScheme.primary else Color.Transparent, CircleShape).padding(if (chosen) 4.dp else 7.dp).background(Color(color), CircleShape).clickable { inkColor = color.toInt() })
                            }
                        }
                    }
                }
                Text(report, Modifier.padding(horizontal = 16.dp, vertical = 5.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    if (showNew) AlertDialog(onDismissRequest = { showNew = false }, title = { Text("新建画布") }, text = {
        Column {
            OutlinedTextField(newTitle, { newTitle = it }, label = { Text("笔记名称") }, singleLine = true)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("ruled" to "横线", "dots" to "点阵", "blank" to "空白").forEach { (value, label) -> FilterChip(newPaper == value, { newPaper = value }, label = { Text(label) }) }
            }
        }
    }, confirmButton = { TextButton(onClick = { model.create(newTitle, newPaper); showNew = false }) { Text("创建") } }, dismissButton = { TextButton(onClick = { showNew = false }) { Text("取消") } })
    if (rename) AlertDialog(onDismissRequest = { rename = false }, title = { Text("重命名") }, text = { OutlinedTextField(renamedTitle, { renamedTitle = it }, singleLine = true) }, confirmButton = { TextButton(onClick = { model.rename(renamedTitle); rename = false }) { Text("保存") } })
    if (confirmClear) AlertDialog(onDismissRequest = { confirmClear = false }, title = { Text("清空当前页的笔迹？") }, text = { Text("可以用撤销恢复。PDF 和纸张会保留。") }, confirmButton = { TextButton(onClick = { activity.drawingSurface?.clearPage(); confirmClear = false }) { Text("清空笔迹") } }, dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("取消") } })
    if (settings) ModalBottomSheet(onDismissRequest = { settings = false }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 32.dp)) {
            Text("书写设置", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}", style = MaterialTheme.typography.bodySmall)
            Text("当前屏幕 ${activity.display?.refreshRate?.toInt() ?: 0} Hz", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
            SettingSwitch("仅用笔书写", "手指移动页面，两指缩放", penOnly) { penOnly = it }
            SettingSwitch("笔迹预测", "提前显示预测轨迹；保存真实采样点", prediction) { prediction = it }
            var highRefresh by remember { mutableStateOf(activity.highRefresh) }
            SettingSwitch("优先高刷新率", "向系统请求当前分辨率下的最高刷新率", highRefresh) { highRefresh = it; activity.applyRefreshMode(it) }
            Text("画笔粗细 ${"%.1f".format(nibSize)}", Modifier.padding(top = 12.dp))
            Slider(nibSize, { nibSize = it }, valueRange = .6f..6f)
            if (note != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { whenIdle { model.pendingExport = note; exportPdf.launch("${note.title}.pdf"); settings = false } }) { Text("导出 PDF") }
                FilledTonalButton(onClick = { whenIdle { model.pendingExport = note; exportBackup.launch("${note.title}.inknative"); settings = false } }) { Text("导出原生备份") }
                OutlinedButton(onClick = { whenIdle { confirmClear = true; settings = false } }) { Text("清空本页") }
            }
            Text("这是原生书写测试版。备份使用 .inknative，旧版 .inknote 和 JavaScript 插件的迁移尚未接入。", Modifier.padding(top = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SettingSwitch(title: String, description: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Medium); Text(description, style = MaterialTheme.typography.bodySmall) }
        Switch(checked, onChange)
    }
}
