/**
 * Host companion for @westwall/dsh-web-clipper.
 *
 * Capture and extraction stay in the desktop renderer. The Host owns the
 * readable copy: it resolves the configured folder, writes the Markdown, and
 * opens that folder in Finder or Explorer on request.
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import {
  openDirectory as openCopyFolder,
  resolveDirectory,
  saveCopy as writeCopy,
  type CopyDirectoryResult,
  type CopySaveOutcome,
  type OpenDirectoryOutcome,
} from './copy.ts'

/** Live, machine-local leaves; editing the folder does not restart the plugin. */
export const Config = z.object({
  outputDirectory: z.string().default('').volatile(),
})

function deref(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { get?: unknown }
    if (typeof candidate.get === 'function') return (candidate.get as () => unknown)()
  }
  return value
}

export default class WebClipper extends TypertRemoteService {
  static Config = Config

  constructor(ctx: Context, _validatedConfig: unknown) {
    super(ctx, 'webClipper')
  }

  private get configuredDirectory(): string {
    const raw = deref(this.ctx.fiber.rawConfig)
    if (typeof raw !== 'object' || raw === null) return ''
    const value = deref((raw as { outputDirectory?: unknown }).outputDirectory)
    return typeof value === 'string' ? value : ''
  }

  /** Report both the stored value and the folder actually used. */
  async directory(): Promise<CopyDirectoryResult> {
    return resolveDirectory(this.configuredDirectory)
  }

  /** Write one Markdown or HTML copy beside the conversation attachment. */
  async saveCopy(name: string, content: string): Promise<CopySaveOutcome> {
    return writeCopy(this.configuredDirectory, name, content)
  }

  /** Create the effective folder if needed and open it in the desktop file manager. */
  async openDirectory(): Promise<OpenDirectoryOutcome> {
    return openCopyFolder(this.configuredDirectory)
  }
}
