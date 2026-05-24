setTimeout(() => {
  self.postMessage({
    id: '550e8400-e29b-41d4-a716-446655440000',
    event: 'test.message',
    payload: { value: 42 }
  })
}, 10)

setTimeout(() => {}, 100000)
