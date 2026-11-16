import test from 'node:test';
import assert from 'node:assert/strict';
import { checkManifest, API_VERSION } from '../app/plugin-host.mjs';

test('插件说明 plugin.json：检查 id、名称、版本和接口版本', () => {
  const ok = checkManifest({ id: 'cornell-canvas', name: '康奈尔', version: '1.0.0', apiVersion: API_VERSION, documents: [{ kind: 'notebook', canvasType: 'cornell' }, { bad: 1 }] }, { expectId: 'cornell-canvas' });
  assert.equal(ok.main, 'index.mjs'); assert.deepEqual(ok.documents, [{ kind: 'notebook', canvasType: 'cornell' }]);
  assert.throws(() => checkManifest({ id: 'Bad Id', name: 'x', version: '1.0.0', apiVersion: 1 }), /小写字母/);
  assert.throws(() => checkManifest({ id: 'abc', name: 'x', version: '1.0.0', apiVersion: 1 }, { expectId: 'abd' }), /不一致/);
  assert.throws(() => checkManifest({ id: 'abc', name: 'x', version: 'v1', apiVersion: 1 }), /版本号/);
  assert.throws(() => checkManifest({ id: 'abc', name: 'x', version: '1.0.0', apiVersion: 2 }), /接口版本 2/);
  assert.throws(() => checkManifest({ id: 'abc', name: 'x', version: '1.0.0', apiVersion: 1, main: '../evil.mjs' }), /main/);
});
