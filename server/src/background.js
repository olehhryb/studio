export async function runBackground(task) {
  return Promise.resolve()
    .then(() => task())
    .catch((err) => {
      console.error(err);
    });
}
