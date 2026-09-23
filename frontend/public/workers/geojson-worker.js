// Web Worker for offloading GeoJSON parsing and validation from main thread
self.onmessage = function(e) {
  const { id, geojsonText, action } = e.data;
  try {
    if (action === 'parse') {
      const data = typeof geojsonText === 'string' ? JSON.parse(geojsonText) : geojsonText;

      // Normalize to FeatureCollection
      let features = [];
      if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        features = data.features;
      } else if (data && data.type === 'Feature') {
        features = [data];
      } else if (Array.isArray(data)) {
        features = data;
      }

      // Validate: filter out features without valid geometry
      const valid = features.filter(f => 
        f && f.geometry && f.geometry.coordinates && 
        Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length > 0
      );

      // Send back in chunks of 500 for progressive rendering
      const CHUNK_SIZE = 500;
      const totalChunks = Math.ceil(valid.length / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = valid.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        self.postMessage({
          id,
          action: 'chunk',
          chunk: { type: 'FeatureCollection', features: chunk },
          chunkIndex: i,
          totalChunks,
          totalFeatures: valid.length,
        });
      }

      self.postMessage({ id, action: 'done', totalFeatures: valid.length });
    }
  } catch (err) {
    self.postMessage({ id, action: 'error', error: err.message });
  }
};
