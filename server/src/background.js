export async function runBackground(task) {
  const work = Promise.resolve()
    .then(() => task())
    .catch((err) => {
      console.error(err);
    });
  if (process.env.VERCEL) {
    try {
      const { waitUntil } = await import("@vercel/functions");
      waitUntil(work);
    } catch {
      await work;
    }
  }
  return work;
}
