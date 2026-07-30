import test from 'node:test'
import assert from 'node:assert/strict'
import { getSuppliers, validSupplierId } from '../functions/_lib/suppliers.js'

test('supplier configuration uses generic defaults and accepts private runtime configuration', () => {
  assert.deepEqual(getSuppliers().map((supplier) => supplier.id), ['supplier-1', 'supplier-2'])
  const env = { SUPPLIERS_JSON: JSON.stringify([{ id: 'vendor-a', name: 'Vendor A', source: 'local' }]) }
  assert.equal(validSupplierId('vendor-a', env), 'vendor-a')
  assert.equal(validSupplierId('supplier-1', env), '')
})

test('invalid supplier configuration falls back without exposing partial data', () => {
  const env = { SUPPLIERS_JSON: JSON.stringify([{ id: '../private', name: 'Private' }]) }
  assert.deepEqual(getSuppliers(env).map((supplier) => supplier.id), ['supplier-1', 'supplier-2'])
})
