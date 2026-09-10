export interface LookupItem {
  serialNumber: string;
  normalizedSerial: string;
}

export interface LookupOutcome<T> {
  status: "success" | "error";
  data?: T;
  error?: string;
  attempts: number;
}

export interface LookupProgress {
  totalDevices: number;
  uniqueRequests: number;
  completed: number;
  succeeded: number;
  failed: number;
  retries: number;
  duplicatesReused: number;
  paused: boolean;
}

interface LookupQueueOptions<T> {
  items: LookupItem[];
  lookup: (serial: string, signal: AbortSignal) => Promise<T>;
  concurrency?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onProgress?: (progress: LookupProgress) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Lookup failed";
}

function isTransient(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "transient" in error && (error as { transient?: unknown }).transient === true);
}

export class LookupQueue<T> {
  readonly results = new Map<string, LookupOutcome<T>>();
  readonly progress: LookupProgress;

  private readonly items: LookupItem[];
  private readonly lookup: LookupQueueOptions<T>["lookup"];
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: number;
  private readonly sleep: NonNullable<LookupQueueOptions<T>["sleep"]>;
  private readonly onProgress?: LookupQueueOptions<T>["onProgress"];
  private paused = false;
  private resumeWaiters: Array<() => void> = [];

  constructor(options: LookupQueueOptions<T>) {
    const unique = new Map<string, LookupItem>();
    for (const item of options.items) {
      if (!unique.has(item.normalizedSerial)) unique.set(item.normalizedSerial, item);
    }
    this.items = [...unique.values()];
    this.lookup = options.lookup;
    this.concurrency = Math.max(1, options.concurrency ?? 3);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 25_000);
    this.backoffMs = Math.max(0, options.backoffMs ?? 600);
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.onProgress = options.onProgress;
    this.progress = {
      totalDevices: options.items.length,
      uniqueRequests: this.items.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      retries: 0,
      duplicatesReused: options.items.length - this.items.length,
      paused: false,
    };
  }

  pause(): void {
    this.paused = true;
    this.progress.paused = true;
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.progress.paused = false;
    const waiters = this.resumeWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
    this.emit();
  }

  async start(): Promise<Map<string, LookupOutcome<T>>> {
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < this.items.length) {
        await this.waitIfPaused();
        const item = this.items[nextIndex];
        nextIndex += 1;
        const result = await this.runOne(item.serialNumber);
        this.results.set(item.normalizedSerial, result);
        this.progress.completed += 1;
        if (result.status === "success") this.progress.succeeded += 1;
        else this.progress.failed += 1;
        this.emit();
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, this.items.length) }, worker));
    return this.results;
  }

  async retry(normalizedSerial: string): Promise<LookupOutcome<T>> {
    const item = this.items.find((candidate) => candidate.normalizedSerial === normalizedSerial);
    if (!item) throw new Error(`Unknown serial: ${normalizedSerial}`);
    const previous = this.results.get(normalizedSerial);
    const result = await this.runOne(item.serialNumber);
    this.results.set(normalizedSerial, result);
    if (previous?.status === "error" && result.status === "success") {
      this.progress.failed = Math.max(0, this.progress.failed - 1);
      this.progress.succeeded += 1;
    }
    this.emit();
    return result;
  }

  private async waitIfPaused(): Promise<void> {
    if (!this.paused) return;
    await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
  }

  private async runOne(serial: string): Promise<LookupOutcome<T>> {
    let attempts = 0;
    while (attempts < this.maxAttempts) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const data = await this.lookup(serial, controller.signal);
        clearTimeout(timer);
        return { status: "success", data, attempts };
      } catch (error) {
        clearTimeout(timer);
        if (!isTransient(error) || attempts >= this.maxAttempts) {
          return { status: "error", error: errorMessage(error), attempts };
        }
        this.progress.retries += 1;
        this.emit();
        const delay = this.backoffMs * (2 ** (attempts - 1)) + Math.floor(Math.random() * Math.max(1, this.backoffMs / 4));
        await this.sleep(delay);
      }
    }
    return { status: "error", error: "Lookup failed", attempts };
  }

  private emit(): void {
    this.onProgress?.({ ...this.progress });
  }
}
