import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

export function validCleanupIds(ids: unknown): ids is number[] {
  return Array.isArray(ids) && ids.length <= 10000 && ids.every(id => Number.isSafeInteger(id) && id > 0)
}

/** SQLite checks status in the DELETE statement; both tables commit together. Files are untouched. */
export function clearFailedTasks(taskIds: number[], mergeIds: number[]) {
  return db.transaction(tx => {
    const task_ids = taskIds.length ? tx.delete(schema.sysTask)
      .where(and(inArray(schema.sysTask.id, [...new Set(taskIds)]), eq(schema.sysTask.status, 'failed')))
      .returning({ id: schema.sysTask.id }).all().map(row => row.id) : []
    const merge_ids = mergeIds.length ? tx.delete(schema.videoMerges)
      .where(and(inArray(schema.videoMerges.id, [...new Set(mergeIds)]), eq(schema.videoMerges.status, 'failed')))
      .returning({ id: schema.videoMerges.id }).all().map(row => row.id) : []
    return { task_ids, merge_ids, count: task_ids.length + merge_ids.length }
  })
}
