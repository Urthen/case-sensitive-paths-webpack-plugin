/* eslint-env mocha */
/* eslint-disable strict */

'use strict';

const isPlatformCaseInsensitive = /^[win|darwin]/.test(process.platform);

const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const webpack = require('webpack');
const webpackPkg = require('webpack/package.json');

const CaseSensitivePathsPlugin = require('../');

function webpackCompilerAtDir(dir, otherOpts) {
  const opts = Object.assign({
    context: path.join(__dirname, 'fixtures', dir),
    entry: './entry',
    output: {
      path: path.join(__dirname, 'js'),
      filename: 'result.js',
    },
    plugins: [
      new CaseSensitivePathsPlugin(),
    ],
  }, otherOpts);

  if (webpackPkg.version[0] === '4') {
    opts.mode = 'development';
  }

  return webpack(opts);
}

describe('CaseSensitivePathsPlugin', () => {
  // This test will fail on case sensitive platforms, that's the whole point of this module.
  // To ensure the rest of the library still works, disable *only this test.*
  if (isPlatformCaseInsensitive) {
    it('should compile and warn on wrong filename case', (done) => {
      const compiler = webpackCompilerAtDir('wrong-case');

      compiler.run((err, stats) => {
        if (err) done(err);
        assert(stats.hasErrors());
        assert.equal(stats.hasWarnings(), false);
        const jsonStats = stats.toJson();
        assert.equal(jsonStats.errors.length, 1);

        const error = jsonStats.errors[0];
        // check that the plugin produces the correct output
        assert(error.indexOf('[CaseSensitivePathsPlugin]') > -1);
        assert(error.indexOf('ExistingTestFile.js') > -1); // wrong file require
        assert(error.indexOf('existingTestFile.js') > -1); // actual file name

        done();
      });
    });
  }

  // For future reference: This test is somewhat of a race condition, these values seem to work well.
  // If this test fails, sometimes just re-running will make it succeed.
  it('should handle the deletion of a folder', (done) => {
    const compiler = webpackCompilerAtDir('deleting-folder', { cache: false, watch: true });

    // create folder and file to be deleted
    const testFolder = path.join(__dirname, 'fixtures', 'deleting-folder', 'test-folder');
    const testFile = path.join(testFolder, 'testfile.js');
    if (!fs.existsSync(testFolder)) fs.mkdirSync(testFolder);
    if (!fs.existsSync(testFile)) fs.writeFileSync(testFile, "module.exports = '';");

    let watchCount = 0;
    let resolved = false;
    let jsonStats;
    const watcher = compiler.watch({ poll: 500, aggregateTimeout: 500 }, (err, stats) => {
      // We already detected the change and marked ourselves done, don't continue.
      // Short circuits some intermittent test errors where this would be called again after
      // test completion.
      if (resolved) {
        return;
      }

      if (err) done(err);
      watchCount += 1;

      if (watchCount === 1) {
        // First run should not error.
        assert(!stats.hasErrors());
        assert(!stats.hasWarnings());

        setTimeout(() => {
          // after initial compile delete test folder
          fs.unlinkSync(testFile);
          fs.rmdirSync(testFolder);
        }, 500);
      } else if (stats.hasErrors()) {
        assert(!stats.hasWarnings());

        jsonStats = stats.toJson();
        assert.equal(jsonStats.errors.length, 1);

        resolved = true;
        watcher.close(done);
      } else {
        throw Error('Did not detect error when folder was deleted. Try rerunning the test.');
      }
    });
  });

  it('should handle the creation of a new file', (done) => {
    const compiler = webpackCompilerAtDir('file-creation');

    const testFile = path.join(__dirname, 'fixtures', 'file-creation', 'testfile.js');
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    let compilationCount = 0;
    compiler.watch({}, (err, stats) => {
      if (err) done(err);
      compilationCount += 1;
      console.log(compilationCount);
      if (compilationCount === 1) {
        const error = stats.toJson().errors[0];

        console.log(stats.hasErrors(), stats.hasWarnings(), stats.toJson());
        console.dir(stats.toJson());

        assert(stats.hasErrors());
        assert(error.indexOf('Cannot resolve') !== -1 || error.indexOf('Can\'t resolve') !== -1);
        assert(!stats.hasWarnings());

        fs.writeFileSync(testFile, 'module.exports = 0;');
      } else if (compilationCount === 2) {
        console.log(stats.hasErrors(), stats.hasWarnings());
        console.dir(stats.toJson());

        assert(fs.existsSync(testFile), 'Test file should exist');
        assert(!stats.hasErrors(), `Should have no errors, but has: \n${stats.toJson().errors}`);
        assert(!stats.hasWarnings());
        fs.unlinkSync(testFile);
        done();
      } else {
        throw new Error('Should not reach this point!');
      }
    });
  });

  it('should work with alternate fileSystems', (done) => {
    let called = false;

    webpack({
      context: path.join(__dirname, 'fixtures', 'wrong-case'),
      target: 'node',
      output: {
        path: path.join(__dirname, 'js'),
        filename: 'result.js',
      },
      entry: './entry',
      plugins: [
        new CaseSensitivePathsPlugin(),
        {
          apply(compiler) {
            let readdir;

            const onCompile = () => {
              readdir = readdir || compiler.inputFileSystem.readdir;
              // eslint-disable-next-line no-param-reassign
              compiler.inputFileSystem.readdir = function (p, cb) {
                called = true;
                fs.readdir(p, cb);
              };
            };

            if (compiler.hooks) {
              compiler.hooks.compile.tap('test', onCompile);
            } else {
              compiler.plugin('compile', onCompile);
            }
          },
        },
      ],
    }, (err) => {
      if (err) done(err);
      assert(called, 'should use compiler fs');
      done();
    });
  });
});
