/*
 * Local AI provider contract.
 * The core works without AI. An Ollama/local-VLM adapter can be enabled later.
 */
export class LocalVisionProvider {
  constructor({endpoint="http://127.0.0.1:11434", model=""}={}) {
    this.endpoint = endpoint.replace(/\/$/,"");
    this.model = model;
  }
  get available() { return Boolean(this.model); }
  async analyze() {
    if (!this.model) throw new Error("No local model configured. Deterministic/PDF/OCR processing can continue without it.");
    throw new Error("Local model adapter is intentionally isolated; configure your approved local VLM endpoint.");
  }
}
export class NullVisionProvider {
  get available() { return false; }
  async analyze() { return {characteristics:[], unresolved:true, reason:"No local VLM configured"}; }
}
