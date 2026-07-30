const HASH_SIZE = 8
const SAMPLE_SIZE = 32

export async function createVisualHash(source) {
  const bitmap = await createImageBitmap(source)
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  bitmap.close?.()

  const rgba = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  const grayscale = new Float64Array(SAMPLE_SIZE * SAMPLE_SIZE)
  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4
    grayscale[index] = rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114
  }

  const coefficients = lowFrequencyDct(grayscale)
  const values = coefficients.slice(1)
  const median = [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]
  let bits = 0n
  coefficients.forEach((value, index) => {
    if (index > 0 && value > median) bits |= 1n << BigInt(63 - index)
  })
  return bits.toString(16).padStart(16, '0')
}

export function hammingDistance(left, right) {
  if (!/^[a-f0-9]{16}$/iu.test(left || '') || !/^[a-f0-9]{16}$/iu.test(right || '')) return Number.POSITIVE_INFINITY
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`)
  let count = 0
  while (difference) {
    difference &= difference - 1n
    count += 1
  }
  return count
}

function lowFrequencyDct(pixels) {
  const coefficients = new Float64Array(HASH_SIZE * HASH_SIZE)
  const cosine = Array.from({ length: HASH_SIZE }, (_, frequency) =>
    Float64Array.from({ length: SAMPLE_SIZE }, (_, position) => Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * SAMPLE_SIZE))),
  )
  for (let vertical = 0; vertical < HASH_SIZE; vertical += 1) {
    for (let horizontal = 0; horizontal < HASH_SIZE; horizontal += 1) {
      let sum = 0
      for (let y = 0; y < SAMPLE_SIZE; y += 1) {
        for (let x = 0; x < SAMPLE_SIZE; x += 1) {
          sum += pixels[y * SAMPLE_SIZE + x] * cosine[horizontal][x] * cosine[vertical][y]
        }
      }
      coefficients[vertical * HASH_SIZE + horizontal] = sum
    }
  }
  return coefficients
}
