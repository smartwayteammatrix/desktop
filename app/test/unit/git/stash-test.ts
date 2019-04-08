import * as FSE from 'fs-extra'
import * as path from 'path'
import { Repository } from '../../../src/models/repository'
import { setupEmptyRepository } from '../../helpers/repositories'
import { GitProcess } from 'dugite'
import {
  getDesktopStashEntries,
  createDesktopStashMessage,
  createDesktopStashEntry,
  getLastDesktopStashEntryForBranch,
  dropDesktopStashEntry,
  IStashEntry,
  applyStashEntry,
} from '../../../src/lib/git/stash'
import { getTipOrError } from '../../helpers/git'
import { getStatusOrThrow } from '../../helpers/status'
import { AppFileStatusKind } from '../../../src/models/status'

describe('git/stash', () => {
  describe('getDesktopStashEntries', () => {
    let repository: Repository
    let readme: string

    beforeEach(async () => {
      repository = await setupEmptyRepository()
      readme = path.join(repository.path, 'README.md')
      await FSE.writeFile(readme, '')
      await GitProcess.exec(['add', 'README.md'], repository.path)
      await GitProcess.exec(['commit', '-m', 'initial commit'], repository.path)
    })

    it('handles unborn repo by returning empty list', async () => {
      const repo = await setupEmptyRepository()

      const entries = await getDesktopStashEntries(repo)

      expect(entries).toHaveLength(0)
    })

    it('returns an empty list when no stash entries have been created', async () => {
      const entries = await getDesktopStashEntries(repository)

      expect(entries).toHaveLength(0)
    })

    it('returns all stash entries created by Desktop', async () => {
      await generateTestStashEntry(repository, 'master', false)
      await generateTestStashEntry(repository, 'master', false)
      await generateTestStashEntry(repository, 'master', true)

      const stashEntries = await getDesktopStashEntries(repository)

      expect(stashEntries).toHaveLength(1)
      expect(stashEntries[0].branchName).toBe('master')
    })
  })

  describe('createDesktopStashEntry', () => {
    let repository: Repository
    let readme: string

    beforeEach(async () => {
      repository = await setupEmptyRepository()
      readme = path.join(repository.path, 'README.md')
      await FSE.writeFile(readme, '')
      await GitProcess.exec(['add', 'README.md'], repository.path)
      await GitProcess.exec(['commit', '-m', 'initial commit'], repository.path)
    })

    it('creates a stash entry when repo is not unborn or in any kind of conflict or rebase state', async () => {
      await FSE.appendFile(readme, 'just testing stuff')

      const tipCommit = await getTipOrError(repository)
      await createDesktopStashEntry(repository, 'master', tipCommit.sha)
    })

    it('stashes untracked files and removes them from the working directory', async () => {
      const untrackedFile = path.join(repository.path, 'not-tracked.txt')
      FSE.writeFile(untrackedFile, 'some untracked file')

      let status = await getStatusOrThrow(repository)
      let files = status.workingDirectory.files

      expect(files).toHaveLength(1)
      expect(files[0].status.kind).toBe(AppFileStatusKind.Untracked)

      const tip = await getTipOrError(repository)
      await createDesktopStashEntry(repository, 'master', tip.sha)

      status = await getStatusOrThrow(repository)
      files = status.workingDirectory.files

      expect(files).toHaveLength(0)
    })
  })

  describe('getLastDesktopStashEntryForBranch', () => {
    let repository: Repository
    let readme: string

    beforeEach(async () => {
      repository = await setupEmptyRepository()
      readme = path.join(repository.path, 'README.md')
      await FSE.writeFile(readme, '')
      await GitProcess.exec(['add', 'README.md'], repository.path)
      await GitProcess.exec(['commit', '-m', 'initial commit'], repository.path)
    })

    it('returns null when no stash entries exist for branch', async () => {
      await generateTestStashEntry(repository, 'some-other-branch', true)

      const entry = await getLastDesktopStashEntryForBranch(
        repository,
        'master'
      )

      expect(entry).toBeNull()
    })

    it('returns last entry made for branch', async () => {
      const branchName = 'master'
      await generateTestStashEntry(repository, branchName, true)
      await generateTestStashEntry(repository, branchName, true)

      const stashEntries = await getDesktopStashEntries(repository)
      // entries are returned in LIFO order
      const lastEntry = stashEntries[0]

      const actual = await getLastDesktopStashEntryForBranch(
        repository,
        branchName
      )

      expect(actual).not.toBeNull()
      expect(actual!.stashSha).toBe(lastEntry.stashSha)
    })
  })

  describe('createDesktopStashMessage', () => {
    it('creates message that matches Desktop stash entry format', () => {
      const branchName = 'master'
      const tipSha = 'bc45b3b97993eed2c3d7872a0b766b3e29a12e4b'

      const message = createDesktopStashMessage(branchName, tipSha)

      expect(message).toBe(
        '!!GitHub_Desktop<master@bc45b3b97993eed2c3d7872a0b766b3e29a12e4b>'
      )
    })
  })

  describe('dropDesktopStashEntry', () => {
    let repository: Repository
    let readme: string

    beforeEach(async () => {
      repository = await setupEmptyRepository()
      readme = path.join(repository.path, 'README.md')
      await FSE.writeFile(readme, '')
      await GitProcess.exec(['add', 'README.md'], repository.path)
      await GitProcess.exec(['commit', '-m', 'initial commit'], repository.path)
    })

    it('removes the entry identified by `stashSha`', async () => {
      await generateTestStashEntry(repository, 'master', true)
      await generateTestStashEntry(repository, 'master', true)

      let stashEntries = await getDesktopStashEntries(repository)
      expect(stashEntries.length).toBe(2)

      const stashToDelete = stashEntries[1]
      await dropDesktopStashEntry(repository, stashToDelete.stashSha)

      // using this function to get stashSha since it parses
      // the output from git into easy to use objects
      stashEntries = await getDesktopStashEntries(repository)
      expect(stashEntries.length).toBe(1)
      expect(stashEntries[0].stashSha).not.toEqual(stashToDelete)
    })

    it('does not fail when attempting to delete when stash is empty', async () => {
      let didFail = false
      const doesNotExist: IStashEntry = {
        name: 'stash@{0}',
        branchName: 'master',
        stashSha: 'xyz',
      }

      try {
        await dropDesktopStashEntry(repository, doesNotExist.stashSha)
      } catch {
        didFail = true
      }

      expect(didFail).toBe(false)
    })

    it("does not fail when attempting to delete stash entry that doesn't exist", async () => {
      let didFail = false
      const doesNotExist: IStashEntry = {
        name: 'stash@{4}',
        branchName: 'master',
        stashSha: 'xyz',
      }
      await generateTestStashEntry(repository, 'master', true)
      await generateTestStashEntry(repository, 'master', true)
      await generateTestStashEntry(repository, 'master', true)

      try {
        await dropDesktopStashEntry(repository, doesNotExist.stashSha)
      } catch {
        didFail = true
      }

      expect(didFail).toBe(false)
    })
  })

  describe('applyStashEntry', () => {
    let repository: Repository
    let readme: string

    beforeEach(async () => {
      repository = await setupEmptyRepository()
      readme = path.join(repository.path, 'README.md')
      await FSE.writeFile(readme, '')
      await GitProcess.exec(['add', 'README.md'], repository.path)
      await GitProcess.exec(['commit', '-m', 'initial commit'], repository.path)
    })

    it('restores changes back to the working directory', async () => {
      await generateTestStashEntry(repository, 'master', true)
      const entries = await getDesktopStashEntries(repository)
      expect(entries.length).toBe(1)

      let status = await getStatusOrThrow(repository)
      let files = status.workingDirectory.files
      expect(files).toHaveLength(0)

      const entryToApply = entries[0]
      await applyStashEntry(repository, entryToApply.stashSha)

      status = await getStatusOrThrow(repository)
      files = status.workingDirectory.files
      expect(files).toHaveLength(1)
    })
  })
})

/**
 * Creates a stash entry using `git stash push` to allow for simulating
 * entries created via the CLI and Desktop
 *
 * @param repository the repository to create the stash entry for
 * @param message passing null will similate a Desktop created stash entry
 */
async function stash(
  repository: Repository,
  branchName: string,
  message: string | null
): Promise<void> {
  const tip = await getTipOrError(repository)
  const result = await GitProcess.exec(
    [
      'stash',
      'push',
      '-m',
      message || createDesktopStashMessage(branchName, tip.sha),
    ],
    repository.path
  )

  if (result.exitCode !== 0) {
    throw new Error(result.stderr)
  }
}

async function generateTestStashEntry(
  repository: Repository,
  branchName: string,
  simulateDesktopEntry: boolean
): Promise<void> {
  const message = simulateDesktopEntry ? null : 'Should get filtered'
  const readme = path.join(repository.path, 'README.md')
  await FSE.appendFile(readme, Math.random()) // eslint-disable-line insecure-random
  await stash(repository, branchName, message)
}
