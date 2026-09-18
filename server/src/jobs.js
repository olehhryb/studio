import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { v4 as uuid } from "uuid";
import { config } from "./config.js";

const jobs = new Map();

export function createJob(owner, brief) {
  const id = uuid();
  const job = {
    id,
    owner,
    brief,
    status: "queued",
    createdAt: Date.now(),
    steps: [],
    results: [],
    logs: [],
    error: null,
    events: new EventEmitter(),
  };
  job.events.setMaxListeners(50);
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function serializeJob(job) {
  return {
    id: job.id,
    kind: job.kind || null,
    pageKey: job.pageKey || null,
    status: job.status,
    createdAt: job.createdAt,
    steps: job.steps,
    results: job.results,
    logs: job.logs,
    error: job.error,
  };
}

export function emitJob(job, payload) {
  job.events.emit("event", payload);
}

export function addStep(job, id, message) {
  const step = { id, status: "running", message, startedAt: Date.now() };
  job.steps.push(step);
  emitJob(job, { type: "step", ...step });
  return step;
}

export function finishStep(job, id, message, extra = {}) {
  const step = job.steps.find((s) => s.id === id && s.status === "running") || job.steps.find((s) => s.id === id);
  if (step) {
    step.status = "done";
    step.message = message;
    step.finishedAt = Date.now();
    Object.assign(step, extra);
  }
  emitJob(job, { type: "step", id, status: "done", message, ...extra });
}

export function failStep(job, id, message) {
  const step = job.steps.find((s) => s.id === id && s.status === "running");
  if (step) {
    step.status = "error";
    step.message = message;
    step.finishedAt = Date.now();
  }
  emitJob(job, { type: "step", id, status: "error", message });
}

export function addLog(job, message, extra = {}) {
  const entry = {
    at: Date.now(),
    message: String(message || "").trim(),
    ...extra,
  };
  job.logs.unshift(entry);
  emitJob(job, { type: "log", ...entry });
  return entry;
}

export function addResult(job, result) {
  job.results.push(result);
  emitJob(job, { type: "result", ...result });
}

export async function jobDir(jobId) {
  const dir = path.join(config.storageDir, jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
