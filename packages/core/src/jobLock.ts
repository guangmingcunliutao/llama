/** 同一进程内只允许一个长任务（生成 / 训练）。 */
export class ExclusiveJob {
  private name: string | null = null;

  get current(): string | null {
    return this.name;
  }

  get busy(): boolean {
    return this.name != null;
  }

  acquire(name: string): void {
    if (!name.trim()) throw new Error("任务名不能为空");
    if (this.name) throw new Error(`任务进行中: ${this.name}`);
    this.name = name;
  }

  release(expected?: string): void {
    if (expected != null && this.name !== expected) return;
    this.name = null;
  }
}
