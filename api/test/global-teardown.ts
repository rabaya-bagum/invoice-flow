import { stopCluster } from './global-setup';

export default async function globalTeardown() {
  stopCluster();
}
