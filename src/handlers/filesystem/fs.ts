import path from 'path';
import fs from 'fs/promises';
import * as fsd from 'fs';
import fsN from 'fs';
import axios from 'axios';
import fileSpecifier from '../../utils/fileSpecifier';
import archiver from 'archiver';
import { spawn } from 'child_process';


const sanitizePath = (base: string, relativePath: string): string => {
    const joined = path.join(base, relativePath);

    let resolved: string;
    try {
        resolved = fsN.realpathSync(joined);
    } catch (err: any) {
        if (err.code === "ENOENT") {
            const parent = path.dirname(joined);
            const realParent = fsN.realpathSync(parent);
            resolved = path.join(realParent, path.basename(joined));
        } else {
            throw err;
        }
    }

    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        throw new Error("Invalid path: escapes base directory.");
    }

    return resolved;
};
const requestCache = new Map();

const getDirectorySize = async (
  directory: string,
  depth: number = 0,
  maxDepth: number = 20
): Promise<number> => {
  let totalSize = 0;

  if (depth > maxDepth) {
    console.warn(`Max depth reached at: ${directory}`);
    return totalSize;
  }

  let contents: fsd.Dirent[];

  try {
    contents = await fs.readdir(directory, { withFileTypes: true });
  } catch (err) {
    console.warn(`Failed to read directory: ${directory}`, err);
    return totalSize;
  }

  for (const dirent of contents) {
    const fullPath = path.join(directory, dirent.name);

    if (dirent.name === 'node_modules') {
      continue;
    }

    try {
      const stat = await fs.lstat(fullPath);

      if (stat.isSymbolicLink()) {
        continue;
      }

      if (stat.isDirectory()) {
        totalSize += await getDirectorySize(fullPath, depth + 1, maxDepth);
      } else {
        totalSize += stat.size;
      }
    } catch (err) {
      console.warn(`Failed to process ${fullPath}`, err);
    }
  }

  return totalSize;
};

const getFileSize = async (filePath: string): Promise<number> => {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    } catch (error) {
        console.error(`Error getting file size: ${error}`);
        return 0;
    }
};

const getFileContent = async (filePath: string): Promise<string | null> => {
    try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
            return await fs.readFile(filePath, 'utf-8');
        }
        return null;
    } catch (error) {
        console.error(`Error getting file content: ${error}`);
        return null;
    }
};

const afs = {
    async rename(id: string, oldPath: string, newPath: string) {
        const baseDirectory = path.resolve(`volumes/${id}`);
        const oldFilePath = sanitizePath(baseDirectory, oldPath);
        const newFilePath = sanitizePath(baseDirectory, newPath);

        const newFileDir = path.dirname(newFilePath);
        if (!fsN.existsSync(newFileDir)) {
            await fs.mkdir(newFileDir, { recursive: true });
        }

        // if file rename file else if folder rename folder
        if (fsN.lstatSync(oldFilePath).isFile()) {
            if (fsN.existsSync(newFilePath)) {
                throw new Error('File already exists');
            }
            await fs.rename(oldFilePath, newFilePath);
        } else {
            if (fsN.existsSync(newFilePath)) {
                throw new Error('Folder already exists');
            }
            await fs.rename(oldFilePath, newFilePath);
        }
    },

    async list(id: string, relativePath: string = '/', filter?: string) {
        const currentTime = Date.now();

        if (!requestCache.has(id)) {
            requestCache.set(id, { lastRequest: currentTime, count: 0, cache: null, path: relativePath });
        }

        const rateData = requestCache.get(id);

        if (rateData.cache && currentTime - rateData.lastRequest < 1000 && rateData.path === relativePath) {
            console.log('Cache hit', relativePath);
            return rateData.cache;
        }

        if (currentTime - rateData.lastRequest < 1000) {
            rateData.count += 1;
        } else {
            rateData.count = 1;
        }

        rateData.lastRequest = currentTime;
        rateData.path = relativePath;

        if (rateData.count > 5) {
            rateData.cache = { error: 'Too many requests, please wait 3 seconds.' };
            console.log('Too many requests, please wait 3 seconds.');
            setTimeout(() => requestCache.delete(id), 3000);
            return rateData.cache;
        }

        try {
            const baseDirectory = path.resolve(`volumes/${id}`);
            const targetDirectory = sanitizePath(baseDirectory, relativePath);
            const directoryContents = await fs.readdir(targetDirectory, { withFileTypes: true });
            const results = await Promise.all(directoryContents.map(async dirent => {
                const ext = path.extname(dirent.name).substring(1);
                const category = await fileSpecifier.getCategory(ext);
                let size = null;

                if (dirent.isDirectory()) {
                    const dirPath = path.join(targetDirectory, dirent.name);
                    size = await getDirectorySize(dirPath);
                } else {
                    const filePath = path.join(targetDirectory, dirent.name);
                    size = await getFileSize(filePath);
                }

                return {
                    name: dirent.name,
                    type: dirent.isDirectory() ? 'directory' : 'file',
                    extension: dirent.isDirectory() ? null : ext,
                    category: dirent.isDirectory() ? null : category,
                    size: size
                };
            }));

            const limitedResults = results.slice(0, 256);

            if (filter) {
                return limitedResults.filter(item => item.name.includes(filter));
            }

            rateData.cache = limitedResults;
            return limitedResults;
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`Error listing directory: ${error.message}`);
            } else {
                throw new Error('An unknown error occurred.');
            }
        }
    },

    async getFilePath(id: string, relativePath: string = '/') {
        const baseDirectory = path.resolve(`volumes/${id}`);
        return sanitizePath(baseDirectory, relativePath);
    },

    async getFileSizeHandler(id: string, relativePath: string = '/'): Promise<number> {
        try {
            const baseDirectory = path.resolve(`volumes/${id}`);
            const filePath = sanitizePath(baseDirectory, relativePath);
            return await getFileSize(filePath);
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`Error getting file size: ${error.message}`);
            } else {
                throw new Error('An unknown error occurred.');
            }
        }
    },

    async getDirectorySizeHandler(id: string, relativePath: string = '/'): Promise<number> {
        try {
            const baseDirectory = path.resolve(`volumes/${id}`);
            const dirPath = sanitizePath(baseDirectory, relativePath);
            return await getDirectorySize(dirPath);
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`Error getting directory size: ${error.message}`);
            } else {
                throw new Error('An unknown error occurred.');
            }
        }
    },

    async getFileContentHandler(id: string, relativePath: string = '/'): Promise<string | null> {
        try {
            const baseDirectory = path.resolve(`volumes/${id}`);
            const filePath = sanitizePath(baseDirectory, relativePath);
            return await getFileContent(filePath);
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`Error getting file content: ${error.message}`);
            } else {
                throw new Error('An unknown error occurred.');
            }
        }
    },

    async copy(id: string, sourcePath: string, destinationPath: string, fileName: string): Promise<void> {
        const baseDirectory = path.resolve(`volumes/${id}`);
        const src = sourcePath;
        const dest = sanitizePath(baseDirectory, destinationPath + fileName);

        const stat = await fs.lstat(src);

        if (stat.isDirectory()) {
            await fs.mkdir(dest, { recursive: true });
            const entries = await fs.readdir(src, { withFileTypes: true });
            for (const entry of entries) {
                const srcEntry = path.join(src, entry.name);
                const destEntry = path.join(dest, entry.name);
                await this.copy(id, path.relative(baseDirectory, srcEntry), path.relative(baseDirectory, destEntry), fileName);
            }
        } else {
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.copyFile(src, dest);
        }
    },

    getDownloadPath(id: string, relativePath: string = '/'): string {
        const baseDirectory = path.resolve(`volumes/${id}`);
        return sanitizePath(baseDirectory, relativePath);
    },

    async writeFileContentHandler(id: string, relativePath: string, content: string | Buffer): Promise<void> {
        try {
            const baseDirectory = path.resolve(`volumes/${id}`);
            const filePath = sanitizePath(baseDirectory, relativePath);
            const dir = path.dirname(filePath);

            console.log(`Writing file to ${filePath}, content type: ${typeof content}`);
            await fs.mkdir(dir, { recursive: true });

            if (typeof content === 'string') {
                await fs.writeFile(filePath, content, 'utf-8');
            } else {
                await fs.writeFile(filePath, content);
            }
            console.log(`File written successfully to ${filePath}`);
        } catch (error: unknown) {
            if (error instanceof Error) {
                console.error(`Error writing file content: ${error.message}`);
                throw error;
            } else {
                console.error('An unknown error occurred during file writing.');
                throw new Error('An unknown error occurred during file writing.');
            }
        }
    },

    async rm(id: string, relativePath: string): Promise<void> {
        try {
            const baseDirectory = path.resolve(`volumes/${id}`);
            const targetPath = sanitizePath(baseDirectory, relativePath);

            const stat = await fs.lstat(targetPath);

            if (relativePath === '/') {
                throw new Error('Root directory cannot be deleted.');
            }

            if (stat.isDirectory()) {
                await fs.rm(targetPath, { recursive: true, force: true });
            } else if (stat.isFile()) {
                await fs.unlink(targetPath);
            } else {
                throw new Error('Path is neither a file nor a directory.');
            }
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`Error deleting path: ${error.message}`);
            } else {
                throw new Error('An unknown error occurred.');
            }
        }
    },

    async download(id: string, url: string, relativePath: string, environmentVariables?: Record<string, string>): Promise<void> {
        try {
            const baseDirectory = path.resolve(`volumes/${id}`);
            const filePath = sanitizePath(baseDirectory, relativePath);

            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer'
            });

            if (response.status !== 200) {
                throw new Error(`Failed to download file from ${url}: ${response.statusText}`);
            }

            let fileContent = response.data;

            if (environmentVariables) {
                const regex = /\$ALVKT\((\w+)\)/g;
                fileContent = fileContent.toString().replace(regex, (_: string, variableName: string) => {
                    if (environmentVariables[variableName]) {
                        console.log(environmentVariables[variableName])
                        return environmentVariables[variableName];
                    } else {
                        console.warn(`Variable "${variableName}" not found in environment variables.`);
                        return '';
                    }
                });

                console.log(fileContent)
            }
            const dirPath = path.dirname(filePath);
            await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(filePath, fileContent);
            console.log(`File downloaded successfully to ${filePath}`);
        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Error downloading file: ${error.message}`);
            } else if (error instanceof Error) {
                throw new Error(`Error downloading file: ${error.message}`);
            } else {
                throw new Error('An unknown error occurred during download.');
            }
        }
    },

    async zip(id: string, filePaths: string[] | string, zipname: string): Promise<string> {
        try {
            const baseDirectory = path.resolve(`volumes/${id}`);

            const files = (Array.isArray(filePaths) ? filePaths : [filePaths])
                .flatMap(file =>
                    typeof file === 'string'
                        ? file.split(',').map(f => f.trim())
                        : file
                )
                .map(file => ({
                    cleanPath: file.replace(/[\[\]"']/g, '').trim(),
                    fullPath: path.join(baseDirectory, file.replace(/[\[\]"']/g, '').trim())
                }));

            const firstFileDir = path.dirname(files[0].fullPath);
            const zipPath = path.join(firstFileDir, `${zipname}.zip`);

            await fs.mkdir(path.dirname(zipPath), { recursive: true });

            const zipStream = fsN.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            return new Promise((resolve, reject) => {
                archive.pipe(zipStream);

                archive.on('error', (err) => {
                    reject(new Error(`Archive error: ${err.message}`));
                });

                zipStream.on('close', () => {
                    resolve(zipPath);
                });

                (async () => {
                    for (const { cleanPath, fullPath } of files) {
                        try {
                            const exists = await fs.access(fullPath).then(() => true).catch(() => false);

                            if (!exists) {
                                console.warn(`File not found: ${cleanPath}`);
                                continue;
                            }

                            const stats = await fs.stat(fullPath);
                            if (stats.isDirectory()) {
                                archive.directory(fullPath, cleanPath);
                            } else {
                                archive.file(fullPath, { name: cleanPath });
                            }
                        } catch (err) {
                            console.warn(`Error processing ${cleanPath}:`, err);
                        }
                    }

                    await archive.finalize();
                })().catch((err) => {
                    reject(new Error(`Error during zipping process: ${err.message}`));
                });
            });
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Error creating zip: ${error.message}`);
            } else {
                throw new Error('An unknown error occurred during zip process');
            }
        }
    },

    async unzip(id: string, relativePath: string, zipname: string): Promise<void> {
        try {
            const baseDirectory = path.resolve(`volumes/${id}`);
            const archivePath = path.join(baseDirectory, relativePath, zipname);
            const extractPath = path.dirname(archivePath);

            console.log('Unzip paths:', {
                baseDirectory,
                archivePath,
                extractPath
            });

            const exists = await fs.access(archivePath)
                .then(() => true)
                .catch(() => false);

            if (!exists) {
                throw new Error(`File not found: ${archivePath}`);
            }

            const archiveType = await detectArchiveType(archivePath);
            if (!archiveType) {
                throw new Error('Unsupported archive type');
            }

            await extractArchive(archivePath, extractPath, archiveType);
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Error during unzip: ${error.message}`);
            } else {
                throw new Error('Error during unzip process');
            }
        }
    },

};

async function detectArchiveType(filePath: string): Promise<string | null> {
    const fileExt = path.extname(filePath).toLowerCase();
    switch (fileExt) {
        case '.zip':
            return 'zip';
        case '.tar':
            return 'tar';
        case '.gz':
        case '.tgz':
            return 'gzip';
        case '.rar':
            return 'rar';
        case '.7z':
            return '7z';
        default:
            return null;
    }
}

async function extractArchive(archivePath: string, extractPath: string, type: string): Promise<void> {
    return new Promise((resolve, reject) => {
        let command: string;
        let args: string[] = [];

        if (process.platform === 'win32') {
            // Windows 11
            const explorerPath = 'C:\\Windows\\explorer.exe';
            if (fsN.existsSync(explorerPath)) {
                command = explorerPath;
                args = ['/select,', archivePath];
            }
            // WinRAR
            else if (fsN.existsSync('C:\\Program Files\\WinRAR\\WinRAR.exe')) {
                command = 'C:\\Program Files\\WinRAR\\WinRAR.exe';
                args = ['x', '-y', archivePath, extractPath];
            }
            // 7-Zip
            else if (fsN.existsSync('C:\\Program Files\\7-Zip\\7z.exe')) {
                command = 'C:\\Program Files\\7-Zip\\7z.exe';
                args = ['x', archivePath, `-o${extractPath}`, '-y'];
            }
            // 7-Zip (32-bit)
            else if (fsN.existsSync('C:\\Program Files (x86)\\7-Zip\\7z.exe')) {
                command = 'C:\\Program Files (x86)\\7-Zip\\7z.exe';
                args = ['x', archivePath, `-o${extractPath}`, '-y'];
            }
            else {
                reject(new Error('The archive type is not supported.'));
                return;
            }
        } else {
            switch (type) {
                case 'zip':
                    command = 'unzip';
                    args = ['-o', archivePath, '-d', extractPath];
                    break;
                case 'tar':
                    command = 'tar';
                    args = ['-xf', archivePath, '-C', extractPath];
                    break;
                case 'gzip':
                    command = 'tar';
                    args = ['-xzf', archivePath, '-C', extractPath];
                    break;
                case 'rar':
                    command = 'unrar';
                    args = ['x', archivePath, extractPath];
                    break;
                case '7z':
                    command = '7z';
                    args = ['x', archivePath, `-o${extractPath}`];
                    break;
                default:
                    reject(new Error('The archive type is not supported.'));
                    return;
            }
        }

        const childProcess = spawn(command, args);
        let errorOutput = '';

        childProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        childProcess.stdout.on('data', (data) => {
            console.log(`Display: ${data}`);
        });

        childProcess.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command exited with code ${code}: ${command} ${args.join(' ')}: ${errorOutput}`));
            }
        });

        childProcess.on('error', (err) => {
            reject(new Error(`Command error: ${err.message}`));
        });
    });
}

export default afs;
