import { LogLevel } from "../../helpers/logger/Logger"

export interface AppConfig {
  chunkSize: number
  concurrency: number
  vaultName: string
  dryRun: boolean
  logLevel: LogLevel
  description?: string
}

export type ConfigInput = Partial<Omit<AppConfig, "chunkSize"> & {
  fileSizeInMB: number
}>

export class Config implements AppConfig {
  private static readonly concurrency = 5
  private static readonly vaultName = "my-vault"
  private static readonly logLevel = "info"
  private static readonly defaultChunkSizeMB = 1
  private static readonly dryRun = false

  public readonly defaultChunkSize = 1024 * 1024
  public readonly maxParts = 1e4
  public readonly chunkSize: number
  public readonly concurrency: number
  public readonly vaultName: string
  public readonly dryRun: boolean
  public readonly description?: string
  public readonly logLevel: LogLevel
  private readonly maxChunkSize = this.defaultChunkSize * 1024 * 4

  public constructor(config: ConfigInput = {}) {
    this.chunkSize = this.getChunkSize(config.fileSizeInMB)
    this.concurrency = config.concurrency || Config.concurrency
    this.vaultName = config.vaultName || Config.vaultName
    this.logLevel = config.logLevel || Config.logLevel
    this.dryRun = config.dryRun ?? Config.dryRun

    const { description } = config

    if (description && description.length) {
      this.description = description
    }
  }

  /**
   *
   * @param size number - proposed upload chunk size in MB
   */
  private getChunkSize (size: number = Config.defaultChunkSizeMB): number {
    const defaultSize = this.defaultChunkSize
    if (size * defaultSize < defaultSize) {
      return defaultSize
    }

    const byteSize = defaultSize * Math.pow(2, Math.floor(Math.log2(size)))

    if (byteSize > this.maxChunkSize) {
      throw new ConfigError("chunk size exceeds maximum of 4GB")
    }

    return byteSize
  }
}

export class ConfigError extends Error {}
