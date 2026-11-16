import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/plugins/matrix-canvas/matrix.mjs';

const stroke = n => ({ id: 'a' + n + Math.random().toString(16).slice(2), type: 'pen', color: '#1f1f1f', width: 2, pressure: false, points: [{ x: n, y: n, p: .5 }] });
const page = () => { const p = { annotations: [] }; M.init(p); return p; };

test('二维模板：新建后只有一个模板一个图层，当前层的笔迹放在 page.annotations', () => {
  const p = page(), m = M.get(p);
  assert.equal(m.templates.length, 1); assert.equal(m.templates[0].layers.length, 1); assert.equal(m.live, m.templates[0].active);
  p.annotations.push(stroke(1));
  assert.deepEqual(M.visible(p).length, 1);
});

test('二维模板：切换图层只换数组，锁定层常驻显示，草稿层只在选中时显示', () => {
  const p = page(), m = M.get(p), t = M.tpl(m);
  p.annotations.push(stroke(1)); M.toggleLock(p, t.active);            // 骨架
  const draft = M.addLayer(p); assert.equal(p.annotations.length, 0); p.annotations.push(stroke(2));
  const draft2 = M.addLayer(p); p.annotations.push(stroke(3));
  assert.equal(M.visible(p).length, 2);                                // 骨架 + 草稿 2
  assert.equal(M.lockedBase(p).flat().length, 1);
  M.selectLayer(p, draft.id);
  assert.equal(p.annotations.length, 1); assert.equal(M.layerOf(t, draft2.id).strokes.length, 1); assert.equal(M.visible(p).length, 2);
  M.selectLayer(p, t.layers[0].id);                                    // 选中锁定层：画面只有锁定层
  assert.equal(M.visible(p).length, 1); assert.equal(M.lockedBase(p).length, 0);
});

test('二维模板：合并草稿进上方的锁定层；没有锁定层时把当前层锁定', () => {
  const p = page(), t = M.tpl(M.get(p));
  p.annotations.push(stroke(1));
  let r = M.mergeDown(p); assert.equal(r.result, 'locked'); assert.equal(M.layerOf(t).locked, true);
  M.addLayer(p); p.annotations.push(stroke(2), stroke(3));
  r = M.mergeDown(p); assert.equal(r.result, 'merged'); assert.equal(r.count, 2);
  assert.equal(t.layers.length, 1); assert.equal(p.annotations.length, 3); assert.equal(M.mergeDown(p).result, 'is-locked');
});

test('二维模板：克隆分叉只复制锁定层（新 id），插在当前模板右边，原模板不变', () => {
  const p = page(), m = M.get(p), t1 = M.tpl(m);
  p.annotations.push(stroke(1)); M.toggleLock(p, t1.active); M.addLayer(p); p.annotations.push(stroke(9));
  M.addTemplate(p); M.selectTemplate(p, t1.id);
  const { template, copied } = M.fork(p);
  assert.equal(copied, 1); assert.equal(m.templates[1].id, template.id); assert.equal(m.active, template.id);
  assert.equal(template.title, '模板 1′'); assert.equal(template.layers.length, 2); assert.equal(p.annotations.length, 0);
  assert.notEqual(template.layers[0].strokes[0].id, t1.layers[0].strokes[0].id);
  M.selectTemplate(p, t1.id); assert.equal(p.annotations.length, 1); assert.equal(M.visible(p).length, 2);
});

test('二维模板：删除当前层/模板后选中邻居；最后一个不能删', () => {
  const p = page(), m = M.get(p), t = M.tpl(m);
  assert.equal(M.removeLayer(p, t.active), false); assert.equal(M.removeTemplate(p, m.active), false);
  p.annotations.push(stroke(1)); const l2 = M.addLayer(p); p.annotations.push(stroke(2));
  assert.equal(M.removeLayer(p, l2.id), true); assert.equal(p.annotations.length, 1); assert.equal(M.get(p).live, t.layers[0].id);
});

test('二维模板：bind 修复不一致的数据，不丢笔迹', () => {
  const p = page(), m = M.get(p), t = M.tpl(m); p.annotations.push(stroke(1));
  const l2 = M.addLayer(p); p.annotations.push(stroke(2));
  m.live = null; t.active = t.layers[0].id;                           // 模拟导入后的状态
  M.bind(p);
  assert.equal(m.live, t.layers[0].id); assert.equal(p.annotations.length, 2);
  assert.equal(M.layerOf(t, l2.id).strokes.length, 0);
});

test('二维模板：导入检查拒绝坏数据，重写 id，并交给批注检查函数', () => {
  const util = { annotation: a => { if (!a || a.type !== 'pen') throw new Error('批注数据无效。'); return { ...a, id: 'new' }; } };
  assert.throws(() => M.validate({ templates: [] }, util), /模板数据无效/);
  assert.throws(() => M.validate({ templates: [{ layers: [{ strokes: [{ type: 'evil' }] }] }] }, util), /批注数据无效/);
  const v = M.validate({ active: 'x', templates: [{ id: 'x', title: 'T', active: 'L2', layers: [{ id: 'L1', title: '题干', locked: true, strokes: [stroke(1)] }, { id: 'L2', strokes: [] }] }] }, util);
  assert.equal(v.active, 'x'); assert.equal(v.templates[0].active, 'L2'); assert.equal(v.templates[0].layers[0].strokes[0].id, 'new');
  assert.equal(v.templates[0].layers[1].title, '图层 2'); assert.equal(v.live, null);
});
