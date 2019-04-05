import { IStashEntry } from '../lib/git/stash'
import { CommittedFileChange } from './status'

export enum StashedChangesLoadStates {
  NotLoaded,
  Loading,
}

export type StashedFileChanges =
  | ReadonlyArray<CommittedFileChange>
  | StashedChangesLoadStates

export function updateStashedFileChanges(
  stashEntry: IStashEntry,
  files: ReadonlyArray<CommittedFileChange>
): IStashEntry {
  return { ...stashEntry, files }
}
