import { OrderDirection } from '../src/api/data-storage-search';
import { FileDTO } from '../src/api/file';
import { ROOT_TAG_ID, TagDTO } from '../src/api/tag';
import Backend from '../src/backend/backend';
import { dbInit } from '../src/backend/config';

describe('Backend', () => {
  let TEST_DATABASE_ID_COUNTER = 0;

  function test(name: string, test: (backend: Backend) => Promise<void>) {
    it(name, async () => {
      const db = dbInit(`Test_${TEST_DATABASE_ID_COUNTER++}`);
      const backend = await Backend.init(db, () => {});
      await test(backend);
    });
  }

  const mockTag: TagDTO = {
    id: 'tag1',
    name: 'tag1 name',
    dateAdded: new Date(),
    color: '',
    subTags: [],
    isHidden: false,
  };

  const mockLocationPath = 'c:/test';

  function createMockFiles(count: number) {
    const mockFiles: FileDTO[] = [];

    for (let index = 0; index < count; index++) {
      mockFiles.push({
        absolutePath: `${mockLocationPath}/test (${index}).jpg`,
        relativePath: `test (${index}).jpg`,
        locationId: 'Default location',
        name: `test (${index}).jpg`,
        size: 42,
        width: 640,
        height: 480,
        dateAdded: new Date(),
        dateModified: new Date(),
        dateCreated: new Date(),
        dateLastIndexed: new Date(),
        extension: 'jpg',
        ino: index.toString(),
        id: index.toString(),
        tags: [],
        annotations: '',
        lat: undefined,
        lng: undefined,
      });
    }

    return mockFiles;
  }

  describe('Tag API', () => {
    test('should be able to fetch a tag after adding it', async (backend) => {
      await backend.createTag({ ...mockTag });
      const dbTags = await backend.fetchTags();
      expect(dbTags).toHaveLength(2);
      expect(dbTags[0].id).toBe(ROOT_TAG_ID);
      expect(dbTags[1].id).toBe(mockTag.id);
    });

    describe('removeTag', () => {
      test('should remove the tag from all files with that tag when removing that tag', async (backend) => {
        await backend.createTag({ ...mockTag });
        const [mockFile1, mockFile2] = createMockFiles(2);
        await backend.createFilesFromPath(mockLocationPath, [
          { ...mockFile1, tags: [mockTag.id] },
          { ...mockFile2, tags: [mockTag.id] },
        ]);
        await backend.removeTags([mockTag.id]);
        const dbFiles = await backend.fetchFiles('id', OrderDirection.Desc);
        expect(dbFiles).toHaveLength(2);
        expect(dbFiles[0].tags).toHaveLength(0);
        expect(dbFiles[1].tags).toHaveLength(0);
      });

      test('should not remove other tags from the files of which a tag was deleted', async (backend) => {
        await backend.createTag({ ...mockTag, id: 'tag1' });
        await backend.createTag({ ...mockTag, id: 'tag2' });
        const [mockFile] = createMockFiles(1);
        await backend.createFilesFromPath(mockLocationPath, [
          {
            ...mockFile,
            tags: ['tag1', 'tag2'],
          },
        ]);
        await backend.removeTags(['tag1']);

        const dbFiles = await backend.fetchFiles('id', OrderDirection.Desc);

        expect(dbFiles).toHaveLength(1);

        expect(dbFiles[0].tags).toHaveLength(1);
        expect(dbFiles[0].tags[0]).toBe('tag2');
      });
    });

    describe('removeTags', () => {
      test('should remove only the tags that were deleted from the files that had them', async (backend) => {
        await backend.createTag({ ...mockTag, id: 'tag1' });
        await backend.createTag({ ...mockTag, id: 'tag2' });
        await backend.createTag({ ...mockTag, id: 'tag3' });
        const [mockFile] = createMockFiles(1);
        await backend.createFilesFromPath(mockLocationPath, [
          {
            ...mockFile,
            tags: ['tag1', 'tag2', 'tag3'],
          },
        ]);
        await backend.removeTags(['tag1', 'tag3']);

        const dbFiles = await backend.fetchFiles('id', OrderDirection.Desc);

        expect(dbFiles).toHaveLength(1);

        expect(dbFiles[0].tags).toHaveLength(1);
        expect(dbFiles[0].tags[0]).toBe('tag2');
      });
    });

    // describe('mergeTags', () => {
    // TODO
    // });
  });

  test('saveFiles persists lat/lng fields', async (backend) => {
    const file: FileDTO = {
      id: 'file1',
      ino: 'ino1',
      locationId: 'loc1',
      relativePath: '/a.jpg',
      absolutePath: '/root/a.jpg',
      tags: [],
      dateAdded: new Date(),
      dateModified: new Date(),
      dateLastIndexed: new Date(),
      name: 'a',
      extension: 'jpg',
      size: 100,
      width: 10,
      height: 10,
      dateCreated: new Date(),
      annotations: '{}',
      lat: 48.8566,
      lng: 2.3522,
    };
    await backend.saveFiles([file]);
    const [saved] = await backend.fetchFilesByKey('id', 'file1');
    expect(saved.lat).toBe(48.8566);
    expect(saved.lng).toBe(2.3522);
  });
});
