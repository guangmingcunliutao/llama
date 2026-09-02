/** 按任务名互斥：同名任务不能并行，不同名可以同时跑。 */
export class ExclusiveJob {
  private readonly names = new Set<string>();

  get current(): string | null {
    return this.names.values().next().value ?? null;
  }

  get busy(): boolean {
    return this.names.size > 0;
  }

  running(): string[] {
    return [...this.names];
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  acquire(name: string): void {
    if (!name.trim()) throw new Error("任务名不能为空");
    if (this.names.has(name)) throw new Error(`任务进行中: ${name}`);
    this.names.add(name);
  }

  release(expected?: string): void {
    if (expected != null) {
      this.names.delete(expected);
      return;
    }
    this.names.clear();
  }
}
