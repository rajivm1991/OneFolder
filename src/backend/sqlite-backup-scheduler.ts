import fse from 'fs-extra';
import path from 'path';

import { debounce } from '../../common/timeout';
import { AUTO_BACKUP_TIMEOUT, NUM_AUTO_BACKUPS } from './config';

function getToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getWeekStart(): Date {
  const date = getToday();
  date.setDate(date.getDate() - date.getDay());
  return date;
}

/** Periodically copies a SQLite context file into a backup directory, with daily/weekly rotation. */
export class SqliteBackupScheduler {
  #contextPath: string;
  #backupDirectory: string;
  #lastBackupIndex = 0;
  #lastBackupDate = new Date(0);

  constructor(contextPath: string, backupDirectory: string) {
    this.#contextPath = contextPath;
    this.#backupDirectory = backupDirectory;
  }

  schedule(): void {
    if (new Date().getTime() > this.#lastBackupDate.getTime() + AUTO_BACKUP_TIMEOUT) {
      this.#createPeriodicBackup();
    }
  }

  async backupToFile(targetPath: string): Promise<void> {
    await fse.ensureDir(path.dirname(targetPath));
    await fse.copyFile(this.#contextPath, targetPath);
  }

  static async #copyIfOlderThan(srcPath: string, targetPath: string, cutoff: Date): Promise<void> {
    let shouldCopy = false;
    try {
      const stats = await fse.stat(targetPath);
      shouldCopy = stats.ctime < cutoff;
    } catch (e) {
      shouldCopy = true;
    }
    if (shouldCopy) {
      await fse.copyFile(srcPath, targetPath);
    }
  }

  #createPeriodicBackup = debounce(async (): Promise<void> => {
    const fileName = `auto-backup-${this.#lastBackupIndex}.onefolder`;
    const filePath = path.join(this.#backupDirectory, fileName);

    this.#lastBackupDate = new Date();
    this.#lastBackupIndex = (this.#lastBackupIndex + 1) % NUM_AUTO_BACKUPS;

    try {
      await this.backupToFile(filePath);
      await SqliteBackupScheduler.#copyIfOlderThan(
        filePath,
        path.join(this.#backupDirectory, 'daily.onefolder'),
        getToday(),
      );
      await SqliteBackupScheduler.#copyIfOlderThan(
        filePath,
        path.join(this.#backupDirectory, 'weekly.onefolder'),
        getWeekStart(),
      );
    } catch (e) {
      console.error('Could not create periodic context backup', filePath, e);
    }
  }, 10000);
}
