"use strict";

let assert = require("assert");
let fs = require("fs-extra");
let path = require("path");
let exec = require('child_process').exec;
let webpack = require("webpack");

let CaseSensitivePathsPlugin = require("../");

function webpackCompilerAtDir(dir, otherOpts) {
    let opts = Object.assign({
        context: path.join(__dirname, "fixtures", dir),
        entry: "./entry",
        output: {
            path: path.join(__dirname, "js"),
            filename: "result.js",
        },
        plugins: [
            new CaseSensitivePathsPlugin()
        ]
    }, otherOpts);
    return webpack(opts);
}

describe("CaseSensitivePathsPlugin", function() {

    it("should compile and warn on wrong filename case", function(done) {
        let compiler = webpackCompilerAtDir('wrong-case');

        compiler.run(function(err, stats) {
            if (err) done(err);
            assert(stats.hasErrors());
            assert.equal(stats.hasWarnings(), false);
            let jsonStats = stats.toJson();
            assert.equal(jsonStats.errors.length, 1);

            let error = jsonStats.errors[0];
            // check that the plugin produces the correct output
            console.log(`Error:\n${error}\n<<<`);
            assert(error.indexOf('[CaseSensitivePathsPlugin]') > -1);
            assert(error.indexOf('ExistingTestFile.js') > -1); // wrong file require
            assert(error.indexOf('existingTestFile.js') > -1); // actual file name

            done();
        });
    });

    // For future reference: This test is somewhat of a race condition, these values seem to work well.
    // If this test fails, sometimes just re-running will make it succeed.
    it("should handle the deletion of a folder", function(done) {
        let compiler = webpackCompilerAtDir('deleting-folder', {cache: false, watch: true});

        // create folder and file to be deleted
        let testFolder = path.join(__dirname, "fixtures", "deleting-folder", "test-folder");
        let testFile = path.join(testFolder, "testfile.js");
        if (!fs.existsSync(testFolder)) fs.mkdirSync(testFolder);
        if (!fs.existsSync(testFile)) fs.writeFileSync(testFile, "module.exports = '';");

        let watchCount = 0;
        let resolved = false;
        let jsonStats;
        let watcher = compiler.watch({poll: 500, aggregateTimeout: 500}, function(err, stats) {

            if (err) done(err);
            watchCount++;

            if (watchCount === 1) {
                // First run should not error.
                assert(!stats.hasErrors());
                assert(!stats.hasWarnings());

                setTimeout(function() {
                    // after initial compile delete test folder
                    fs.unlinkSync(testFile);
                    fs.rmdirSync(testFolder);
                }, 500);
            } else {
                if(stats.hasErrors()) {
                    assert(!stats.hasWarnings());

                    jsonStats = stats.toJson();
                    assert.equal(jsonStats.errors.length, 1);

                    resolved = true;
                    watcher.close(done);
                } else {
                    throw Error("Did not detect error when folder was deleted. Try rerunning the test.");
                }
            }
        });
    });

    it("should handle the creation of a new file", function(done) {
        let compiler = webpackCompilerAtDir("file-creation");

        let testFile = path.join(__dirname, "fixtures", "file-creation", "testfile.js");
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

        let compilationCount = 0;
        compiler.watch({}, function(err, stats) {
            if (err) done(err);
            compilationCount++;

            if (compilationCount === 1) {
                assert(stats.hasErrors());
                assert(stats.toJson().errors[0].indexOf('Cannot resolve') !== -1);
                assert(!stats.hasWarnings());

                fs.writeFileSync(testFile, "module.exports = 0;");
            } else if (compilationCount === 2) {
                assert(fs.existsSync(testFile), 'Test file should exist');
                assert(!stats.hasErrors(), 'Should have no errors, but has: \n' + stats.toJson().errors);
                assert(!stats.hasWarnings());
                fs.unlinkSync(testFile);
                done()
            } else {
                throw new Error('Should not reach this point!')
            }
        })
    });

    it("should work with alternate fileSystems", function(done) {
        let called = false;

        webpack({
            context: path.join(__dirname, "fixtures", "wrong-case"),
            target: "node",
            output: {
                path: path.join(__dirname, "js"),
                filename: "result.js"
            },
            entry: "./entry",
            plugins: [
                new CaseSensitivePathsPlugin(),
                {
                    apply: function(compiler) {
                        let readdir;
                        compiler.plugin('compile', function() {
                            readdir = readdir || compiler.inputFileSystem.readdir;
                            compiler.inputFileSystem.readdir = function(p, cb) {
                                called = true;
                                fs.readdir(p, cb);
                            }
                        })
                    }
                }
            ]
        }, function(err, stats) {
            if (err) done(err);
            assert(called, 'should use compiler fs');
            done();
        });
    });
});
