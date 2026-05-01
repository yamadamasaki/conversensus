import type { AtUri, Rkey } from '@conversensus/shared';
import type { RecordResult, StrongRef } from './types';

/** PDS record with URI and CID */
export type RecordEntry<T = unknown> = {
  uri: AtUri;
  cid: string;
  value: T;
};

/** Minimal interface for repo-level record CRUD — what branchState needs from each collection */
export interface CollectionCRUD<T = unknown> {
  put(rkey: Rkey, data: T): Promise<RecordResult>;
  get(rkey: Rkey): Promise<RecordEntry<T>>;
  list(): Promise<RecordEntry<T>[]>;
  delete(rkey: Rkey): Promise<void>;
}

/** Nodes / Edges / Layouts also support prefix listing */
export interface PrefixListable<T = unknown> extends CollectionCRUD<T> {
  listForPrefix(prefix: string): Promise<RecordEntry<T>[]>;
}

/** Collections that support building a StrongRef from id */
export interface Refable {
  ref(id: string): Promise<StrongRef>;
}

/** The set of collection objects used by branch/commit domain functions */
export interface BranchStateDeps {
  branches: CollectionCRUD & Refable;
  commits: CollectionCRUD;
  merges: Pick<CollectionCRUD, 'put'>;
  nodes: PrefixListable;
  edges: PrefixListable;
  nodeLayouts: PrefixListable;
  edgeLayouts: PrefixListable;
  sheets: Pick<CollectionCRUD, 'get'>;
}
