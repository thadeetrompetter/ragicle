import "reflect-metadata"
import { Mock, Times, MockBehavior } from "typemoq"
import { AppConfig } from "../../../../src/app/config/Config"
import { IGlacierUploader, GlacierUploadResult, IGlacierUploadStrategy, GlacierUploaderStrategyMissing, GlacierInitiateUploadFailed, GlacierPartsUploadFailed, GlacierCompleteUploadFailed, GlacierMultipartUploadIdMissing, GlacierUploadArchiveFailed, GlacierArchiveIdMissing } from "../../../../src/services/GlacierUploader/GlacierUploader"
import { IFileHelper, FileInfo, FileHelperError } from "../../../../src/helpers/file/FileHelper"
import { IUploadJobCreator, UploadJob, UploadType, UploadJobCreatorError } from "../../../../src/app/upload-job-creator/UploadJobCreator"
import { GlacierSingleUpload } from "../../../../src/services/GlacierUploader/GlacierSingleUpload"
import { GlacierMultipartUpload } from "../../../../src/services/GlacierUploader/GlacierMultipartUpload"
import { GlacierStubUpload } from "../../../../src/services/GlacierUploader/GlacierStubUpload"
import { Uploader } from "../../../../src/app/uploader/Uploader"
import { ILogger } from "../../../../src/helpers/logger/Logger"
import { UploaderError, ErrorMessages, UploaderUnknownStrategyError } from "../../../../src/app/uploader/UploaderErrors"
import { IVaultCreator, VaultCreatorCreationError, VaultCreatorDescribeError } from "../../../../src/services/VaultCreator/VaultCreator"

describe("Uploader", () => {
  const config = Mock.ofType<AppConfig>(undefined, MockBehavior.Strict)
  const uploadService = Mock.ofType<IGlacierUploader>()
  const fileHelper = Mock.ofType<IFileHelper>()
  const uploadJobCreator = Mock.ofType<IUploadJobCreator>()
  const vaultCreator = Mock.ofType<IVaultCreator>(undefined, MockBehavior.Strict)
  const glacierSingleStrategy = Mock.ofType<GlacierSingleUpload>()
  const glacierMultipartStrategy = Mock.ofType<GlacierMultipartUpload>()
  const glacierStubStrategy = Mock.ofType<GlacierStubUpload>()
  const fileInfo = Mock.ofType<FileInfo>()
  const uploadJob = Mock.ofType<UploadJob>()
  const uploadResult = Mock.ofType<GlacierUploadResult>()
  const logger = Mock.ofType<ILogger>(undefined, MockBehavior.Strict)

  const filePath = "/file/path"

  const uploader = new Uploader(
    config.object,
    uploadService.object,
    fileHelper.object,
    uploadJobCreator.object,
    vaultCreator.object,
    glacierSingleStrategy.object,
    glacierMultipartStrategy.object,
    glacierStubStrategy.object,
    logger.object
  )

  beforeEach(() => {
    config.reset()
    uploadService.reset()
    fileHelper.reset()
    uploadJobCreator.reset()
    vaultCreator.reset()
    fileInfo.reset()
    uploadJob.reset()
    uploadResult.reset()
    logger.reset()
  })

  afterEach(() => {
    config.verifyAll()
    uploadService.verifyAll()
    fileHelper.verifyAll()
    uploadJobCreator.verifyAll()
    vaultCreator.verifyAll()
    fileInfo.verifyAll()
    uploadJob.verifyAll()
    uploadResult.verifyAll()
    logger.verifyAll()
  })

  it.each`uploadType | uploadStrategy
${"single"} | ${glacierSingleStrategy.object}
${"multipart"} | ${glacierMultipartStrategy.object}
`("will upload a file with $uploadType strategy", async ({ uploadType, uploadStrategy }) => {
  const chunkSize = 5
  const fileSize = 15
  const archiveId = "archive id"

  setUpUploadMocks(uploadType, chunkSize, fileSize, archiveId, uploadStrategy)

  logger.setup(l => l.debug(`Using ${uploadType} file upload strategy`))
    .verifiable(Times.once())

  logger.setup(l => l.info(`Successfully uploaded ${filePath} of ${fileSize} Bytes to Glacier.`))
    .verifiable(Times.once())

  await expect(uploader.upload(filePath))
    .resolves
    .toEqual({ archiveId })
})

  it("will set a stub upload strategy", async () => {
    const chunkSize = 5
    const fileSize = 15
    const archiveId = "archive id"
    setUpUploadMocks("single", chunkSize, fileSize, archiveId, glacierStubStrategy.object, true)

    logger.setup(l => l.debug("Using stub file upload strategy"))
      .verifiable(Times.once())

    logger.setup(l => l.info(`Successfully uploaded ${filePath} of ${fileSize} Bytes to Glacier.`))
      .verifiable(Times.once())

    await expect(uploader.upload(filePath))
      .resolves
      .toEqual({ archiveId })
  })

  it("will throw an error if an unknown upload strategy is provided", async () => {
    const chunkSize = 5
    const fileSize = 15
    const archiveId = "archive id"
    const error = new UploaderError(ErrorMessages.unknownUploadStrategy)

    setUpUploadMocks(
      "foo bar" as UploadType,
      chunkSize,
      fileSize,
      archiveId,
      glacierSingleStrategy.object
    )

    uploadService.reset()
    uploadResult.reset()

    await expect(uploader.upload(filePath))
      .rejects
      .toThrowError(error)
  })

  it("will throw a UploaderMaxPartsError error if upload size exceeds max upload parts", async () => {
    const chunkSize = 2
    // more than 10.000 chunks to upload
    const fileSize = 1e4 * 2 + 1
    const error = new UploaderError(ErrorMessages.maxUploadParts)

    config.setup(c => c.chunkSize)
      .returns(() => chunkSize)
      .verifiable(Times.once())

    fileInfo.setup(f => f.size)
      .returns(() => fileSize)
      .verifiable(Times.once())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fileInfo.setup((f: any) => f.then).returns(() => undefined)

    fileHelper.setup(f => f.read(filePath))
      .returns(() => Promise.resolve(fileInfo.object))
      .verifiable(Times.once())

    await expect(uploader.upload(filePath))
      .rejects
      .toThrowError(error)
  })

  it("will throw a UploaderEmptyFileError error if file to upload is empty", async () => {
    // empty file
    const fileSize = 0
    const error = new UploaderError(ErrorMessages.emptyFile)

    fileInfo.setup(f => f.size)
      .returns(() => fileSize)
      .verifiable(Times.once())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fileInfo.setup((f: any) => f.then).returns(() => undefined)

    fileHelper.setup(f => f.read(filePath))
      .returns(() => Promise.resolve(fileInfo.object))
      .verifiable(Times.once())

    await expect(uploader.upload(filePath))
      .rejects
      .toThrowError(error)
  })

  it.each`name | error | result
  ${"UploaderUnknownStrategyError"} | ${new UploaderUnknownStrategyError()} | ${new UploaderError(ErrorMessages.unknownUploadStrategy)}}
  ${"FileHelperError"} | ${new FileHelperError("test")} | ${new UploaderError(`${ErrorMessages.fileHelper}. test`)}}
  ${"GlacierUploaderStrategyMissing"} | ${new GlacierUploaderStrategyMissing()} | ${new UploaderError(ErrorMessages.noUploadStrategy)}}
  ${"GlacierInitiateUploadFailed"} | ${new GlacierInitiateUploadFailed("test")} | ${new UploaderError(`${ErrorMessages.initiateUpload}. test`)}}
  ${"GlacierPartsUploadFailed"} | ${new GlacierPartsUploadFailed("test")} | ${new UploaderError(`${ErrorMessages.partUpload}. test`)}}
  ${"GlacierCompleteUploadFailed"} | ${new GlacierCompleteUploadFailed("test")} | ${new UploaderError(`${ErrorMessages.completeUpload}. test`)}}
  ${"GlacierMultipartUploadIdMissing"} | ${new GlacierMultipartUploadIdMissing()} | ${new UploaderError(ErrorMessages.uploadId)}}
  ${"GlacierUploadArchiveFailed"} | ${new GlacierUploadArchiveFailed("test")} | ${new UploaderError(`${ErrorMessages.archiveUpload}. test`)}}
  ${"GlacierArchiveIdMissing"} | ${new GlacierArchiveIdMissing()} | ${new UploaderError(ErrorMessages.archiveId)}}
  ${"UploadJobCreatorError"} | ${new UploadJobCreatorError("test")} | ${new UploaderError(`${ErrorMessages.jobCreation}. test`)}}
  ${"VaultCreatorCreationError"} | ${new VaultCreatorCreationError("test")} | ${new UploaderError(`${ErrorMessages.vaultCreation}. test`)}}
  ${"VaultCreatorDescribeError"} | ${new VaultCreatorDescribeError("test")} | ${new UploaderError(`${ErrorMessages.vaultDescribe}. test`)}}
  ${"Unknown error"} | ${new Error("test")} | ${new UploaderError(`${ErrorMessages.unknown}. test`)}}
  `("will throw an UploaderError when $name occurs", async ({ error, result }) => {
  const fileReaderMockFunc = jest.fn()
  const fileReaderMock = { read: fileReaderMockFunc }
  fileReaderMockFunc.mockImplementation(() => { throw error })

  const uploader = new Uploader(
    config.object,
    uploadService.object,
    fileReaderMock,
    uploadJobCreator.object,
    vaultCreator.object,
    glacierSingleStrategy.object,
    glacierMultipartStrategy.object,
    glacierStubStrategy.object,
    logger.object
  )

  await expect(uploader.upload(filePath))
    .rejects
    .toThrowError(result)
})

  function setUpUploadMocks(
    uploadType: UploadType,
    chunkSize: number,
    fileSize: number,
    archiveId: string,
    uploadStrategy: IGlacierUploadStrategy,
    dryRun = false
  ): void {
    config.setup(c => c.chunkSize)
      .returns(() => chunkSize)

    config.setup(c => c.dryRun)
      .returns(() => dryRun)

    fileInfo.setup(f => f.size)
      .returns(() => fileSize)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fileInfo.setup((f: any) => f.then).returns(() => undefined)

    fileHelper.setup(f => f.read(filePath))
      .returns(() => Promise.resolve(fileInfo.object))

    uploadJobCreator.setup(u => u.getUploadJob(fileInfo.object))
      .returns(() => uploadJob.object)

    uploadJob.setup(u => u.kind)
      .returns(() => uploadType)

    uploadResult.setup(u => u.archiveId)
      .returns(() => archiveId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    uploadResult.setup((f: any) => f.then).returns(() => undefined)

    vaultCreator.setup(v => v.createVault())
      .returns(() => Promise.resolve())

    uploadService.setup(u => u.setStrategy(uploadStrategy))

    uploadService.setup(u => u.upload(uploadJob.object))
      .returns(() => Promise.resolve(uploadResult.object))
  }
})
