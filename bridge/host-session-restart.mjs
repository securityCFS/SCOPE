// A restart affects a shared daemon, so preflight every group before stopping any.
export class HostSessionRestarts {
  constructor({ prepare, restart, publish = () => {} }) {
    Object.assign(this, { prepare, restart, publish });
    this.jobs = new Map();
  }
  start(host) {
    if (this.jobs.get(host)?.status === "running") return this.jobs.get(host);
    const job = { host, status: "running", phase: "preflight", results: [], error: null };
    this.jobs.set(host, job);
    job.done = this.run(job);
    return job;
  }
  async run(job) {
    try {
      const groups = await this.prepare(job.host);
      job.total = groups.reduce((n, group) => n + group.sessions.length, 0);
      job.phase = "restart";
      for (const group of groups) {
        const results = await this.restart(job.host, group);
        job.results.push(...results);
        await this.publish(job);
      }
      job.status = job.results.some((r) => !r.ok) ? "partial" : "completed";
    } catch (error) {
      job.status = "failed"; job.error = error.message;
    } finally { await this.publish(job); }
  }
  view(host) {
    const job = this.jobs.get(host);
    if (!job) return null;
    const { done, ...publicJob } = job;
    return publicJob;
  }
}
