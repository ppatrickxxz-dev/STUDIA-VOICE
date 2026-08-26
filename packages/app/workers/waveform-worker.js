self.onmessage = ({ data }) => {
  const { id, samples, width = 900 } = data;
  const source = new Float32Array(samples);
  const columns = Math.max(1, Math.min(1800, Math.floor(width)));
  const step = Math.max(1, Math.floor(source.length / columns));
  const peaks = new Float32Array(columns * 2);
  for (let column = 0; column < columns; column += 1) {
    let min = 1;
    let max = -1;
    const end = Math.min(source.length, (column + 1) * step);
    for (let index = column * step; index < end; index += 1) {
      min = Math.min(min, source[index]);
      max = Math.max(max, source[index]);
    }
    peaks[column * 2] = min;
    peaks[column * 2 + 1] = max;
  }
  self.postMessage({ id, peaks: peaks.buffer }, [peaks.buffer]);
};

