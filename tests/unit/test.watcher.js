/* eslint-disable no-console */
/* @flow */
import path from 'path';

import {it, describe} from 'mocha';
import {fs} from 'mz';
import sinon from 'sinon';
import {assert} from 'chai';

import {default as onSourceChange, proxyFileChanges} from '../../src/watcher';
import {withTempDir} from '../../src/util/temp-dir';
import { makeSureItFails } from './helpers';

type AssertWatchedParams = {
  watchFile?: string,
  touchedFile: string,
}

describe('watcher', () => {

  const watchChange = ({
    watchFile,
    touchedFile,
  }: AssertWatchedParams = {}) => withTempDir(
    (tmpDir) => {
      const artifactsDir = path.join(tmpDir.path(), 'web-ext-artifacts');
      const someFile = path.join(tmpDir.path(), touchedFile);

      if (watchFile) {
        watchFile = path.join(tmpDir.path(), watchFile);
      }

      var resolveChange;
      const whenFilesChanged = new Promise((resolve) => {
        resolveChange = resolve;
      });
      const onChange = sinon.spy(() => {
        resolveChange();
      });

      let watchedFilePath;
      let watchedDirPath;

      return fs.writeFile(someFile, '<contents>')
        .then(() => {
          return onSourceChange({
            sourceDir: tmpDir.path(),
            watchFile,
            artifactsDir,
            onChange,
            shouldWatchFile: () => true,
          });
        })
        .then((watcher) => {
          const watchedFile = watcher.fileWatchers[0];
          const watchedDir = watcher.dirWatchers[0];

          watchedFilePath = watchedFile && watchedFile.path;
          watchedDirPath = watchedDir && watchedDir.path;

          return watcher;
        })
        .then((watcher) => {
          return fs.utimes(someFile, Date.now() / 1000, Date.now() / 1000)
            .then(() => watcher);
        }).then((watcher) => {
          const assertParams = {
            onChange,
            watchedFilePath,
            watchedDirPath,
            tmpDirPath: tmpDir.path(),
          };

          return Promise.race([
            whenFilesChanged
              .then(() => {
                watcher.close();
                // This delay seems to avoid stat errors from the watcher
                // which can happen when the temp dir is deleted (presumably
                // before watcher.close() has removed all listeners).
                return new Promise((resolve) => {
                  setTimeout(resolve, 2, assertParams);
                });
              }),
            // Time out if no files are changed
            new Promise((resolve) => setTimeout(() => {
              watcher.close();
              resolve(assertParams);
            }, 500)),
          ]);
        });
    }
  );

  it('watches for changes in the sourceDir', async () => {
    const {
      onChange,
      watchedFilePath,
      watchedDirPath,
      tmpDirPath,
    } = await watchChange({
      touchedFile: 'foo.txt',
    });

    sinon.assert.calledOnce(onChange);
    assert.equal(watchedDirPath, tmpDirPath);
    assert.isUndefined(watchedFilePath);
  });

  describe('--watch-file option is passed in', () => {
    it('changes if the watched file is touched', async () => {
      const {
        onChange,
        watchedFilePath,
        watchedDirPath,
        tmpDirPath,
      } = await watchChange({
        watchFile: 'foo.txt',
        touchedFile: 'foo.txt',
      });

      sinon.assert.calledOnce(onChange);
      assert.isUndefined(watchedDirPath);
      assert.equal(watchedFilePath, path.join(tmpDirPath, 'foo.txt'));
    });

    it('does not change if watched file is not touched', async () => {
      const {
        onChange,
        watchedFilePath,
        watchedDirPath,
        tmpDirPath,
      } = await watchChange({
        watchFile: 'bar.txt',
        touchedFile: 'foo.txt',
      });

      sinon.assert.notCalled(onChange);
      assert.isUndefined(watchedDirPath);
      assert.equal(watchedFilePath, path.join(tmpDirPath, 'bar.txt'));
    });

    it('throws error if a non-file is passed into --watch-file', () => {
      return watchChange({
        watchFile: '/',
        touchedFile: 'foo.txt',
      }).then(makeSureItFails()).catch((error) => {
        assert.match(
          error.message,
          /Invalid --watch-file value: .+ is not a file./
        );
      });
    });
  });

  describe('proxyFileChanges', () => {

    const defaults = {
      artifactsDir: '/some/artifacts/dir/',
      onChange: () => {},
      shouldWatchFile: () => true,
    };

    it('proxies file changes', () => {
      const onChange = sinon.spy(() => {});
      proxyFileChanges({
        ...defaults,
        filePath: '/some/file.js',
        onChange,
      });
      sinon.assert.called(onChange);
    });

    it('ignores changes to artifacts', () => {
      const onChange = sinon.spy(() => {});
      proxyFileChanges({
        ...defaults,
        filePath: '/some/artifacts/dir/build.xpi',
        artifactsDir: '/some/artifacts/dir/',
        onChange,
      });
      sinon.assert.notCalled(onChange);
    });

    it('provides a callback for ignoring files', () => {

      function shouldWatchFile(filePath) {
        if (filePath === '/somewhere/freaky') {
          return false;
        } else {
          return true;
        }
      }

      const conf = {
        ...defaults,
        shouldWatchFile,
        onChange: sinon.spy(() => {}),
      };

      proxyFileChanges({...conf, filePath: '/somewhere/freaky'});
      sinon.assert.notCalled(conf.onChange);
      proxyFileChanges({...conf, filePath: '/any/file/'});
      sinon.assert.called(conf.onChange);
    });

  });

});
