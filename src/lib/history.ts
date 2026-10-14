import type { Doc } from './types'
import { cloneImageData } from './image'

export type Snapshot = { rgb: ImageData; mask: ImageData; width: number; height: number }

export function snap(doc: Doc): Snapshot {
  return { rgb: cloneImageData(doc.rgb), mask: cloneImageData(doc.mask), width: doc.width, height: doc.height }
}

export function restore(doc: Doc, s: Snapshot): Doc {
  return { ...doc, rgb: cloneImageData(s.rgb), mask: cloneImageData(s.mask), width: s.width, height: s.height }
}

export class History {
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []
  push(doc: Doc) {
    this.undoStack.push(snap(doc))
    if (this.undoStack.length > 30) this.undoStack.shift()
    this.redoStack = []
  }
  undo(doc: Doc): Doc | null {
    const s = this.undoStack.pop()
    if (!s) return null
    this.redoStack.push(snap(doc))
    return restore(doc, s)
  }
  redo(doc: Doc): Doc | null {
    const s = this.redoStack.pop()
    if (!s) return null
    this.undoStack.push(snap(doc))
    return restore(doc, s)
  }
  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
}
