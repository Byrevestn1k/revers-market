const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function worker(results) {
  const handlers = {}, shown = [], closed = []
  const registration = {
    showNotification: async (title, options) => { shown.push({ title, ...options }) },
    getNotifications: async () => shown.map(item => ({ data: item.data, close: () => closed.push(item) })),
  }
  const self = { location: { origin: 'https://site.example' }, registration, addEventListener: (name, handler) => { handlers[name] = handler } }
  const fetch = async () => { const active = results.shift(); if (active === 'error') throw Error('offline'); return { ok: true, json: async () => ({ active }) } }
  vm.runInNewContext(fs.readFileSync('frontend/public/sw.js', 'utf8'), { self, fetch, URL, clients: { openWindow: async () => {} } })
  return { handlers, shown, closed }
}
async function push(w) {
  let result
  w.handlers.push({ data: { json: () => ({ binding: '12345678-1234-1234-1234-123456789abc', title: 'private title', body: 'private body', url: '/messages/123' }) }, waitUntil: promise => { result = promise } })
  await result
}
test('expired or offline binding never displays the push', async () => {
  for (const status of [false, 'error']) { const w = worker([status]); await push(w); assert.equal(w.shown.length, 0) }
})
test('account change during display closes it, with only generic text', async () => {
  const w = worker([true, false]); await push(w)
  assert.equal(w.shown.length, 1); assert.equal(w.closed.length, 1)
  assert.equal(w.shown[0].title, 'ДещоТреба'); assert.equal(w.shown[0].body, 'У вас нове сповіщення.')
})
