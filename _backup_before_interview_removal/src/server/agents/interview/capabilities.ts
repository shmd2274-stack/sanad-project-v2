import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../env';

export function datasetCsvPath(): string {
  return path.join(env.sslDatasetDir, 'dataset', 'metadata', 'dataset.csv');
}

/** What the sign-language side can do on this server, reported to the UI. */
export function signCapabilities(): { signLexicon: boolean; signRecognition: 'landmarks' | 'vision' | 'none' } {
  const signLexicon = fs.existsSync(datasetCsvPath());
  const landmarks = Boolean(env.sslPython) && fs.existsSync(env.sslLandmarkIndex);
  return { signLexicon, signRecognition: landmarks ? 'landmarks' : env.anthropicEnabled ? 'vision' : 'none' };
}
