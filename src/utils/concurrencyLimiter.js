/**
 * Limitador de concurrencia para operaciones pesadas
 * Previene sobrecarga de la base de datos cuando hay muchas operaciones simultáneas
 */

class ConcurrencyLimiter {
  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent
    this.running = 0
    this.queue = []
  }

  async run(fn) {
    // Si ya estamos al máximo, esperar en cola
    while (this.running >= this.maxConcurrent) {
      await new Promise(resolve => this.queue.push(resolve))
    }

    this.running++
    try {
      return await fn()
    } finally {
      this.running--
      // Despertar al siguiente en la cola
      const next = this.queue.shift()
      if (next) next()
    }
  }

  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent
    }
  }
}

// Limiter global para operaciones de ventas (máximo 5 transacciones simultáneas)
const salesOperationLimiter = new ConcurrencyLimiter(5)

module.exports = { ConcurrencyLimiter, salesOperationLimiter }
