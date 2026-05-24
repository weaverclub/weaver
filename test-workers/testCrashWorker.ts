console.log('Crash worker started')

setTimeout(() => {
  throw new Error('intentional crash')
}, 50)
