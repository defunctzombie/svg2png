"use strict";
const path = require("path");
const childProcess = require("pn/child_process");
const spawn = require('child_process').spawn;

const phantomjsCmd = require("phantomjs-prebuilt").path;
const converterFileName = path.resolve(__dirname, "./converter.js");

const PREFIX = "data:image/png;base64,";

var cp = spawn(phantomjsCmd, getPhantomJSArgs(undefined));

// queue requests
var queue = [];
var processing = false;

module.exports = function svg2png(sourceBuffer, resize) {
    var promise = new Promise(function(resolve, reject) {
        convert(sourceBuffer, function(err, converted) {
            if (err) {
                return reject(err);
            }

            resolve(converted);
        });
    });

    return promise;
}

function convert(buffer, cb) {
    if (processing) {
        queue.push([new Buffer(buffer), cb]);
        return;
    }

    processing = true;

    var resolve = function(err, val) {
        cp.stdout.removeListener('data', stdout);
        cp.stderr.removeListener('data', stderr);

        cb(err, val);

        processing = false;
        var next = queue.shift();
        if (next) {
            convert(next[0], next[1]);
        }
    };

    cp.stdout.setEncoding('utf8');
    cp.stdout.on('data', stdout);
    cp.stderr.on('data', stderr);

    writeBufferInChunks(cp.stdin, buffer);

    function stdout(chunk) {
        if (chunk.startsWith(PREFIX)) {
            resolve(null, new Buffer(chunk.substring(PREFIX.length), "base64"));
            return;
        }

        var err = new Error('unknown response from phantomjs');
        err.response = chunk;
        resolve(err);
    }

    function stderr(chunk) {
        var err = new Error('unknown response from phantomjs');
        err.response = chunk;
        resolve(err);
    }
};

module.exports.sync = (sourceBuffer, resize) => {
    const result = childProcess.spawnSync(phantomjsCmd, getPhantomJSArgs(resize), {
        input: sourceBuffer.toString("base64")
    });
    return processResult(result);
}

function getPhantomJSArgs(resize) {
    return [
        converterFileName,
        resize === undefined ? "undefined" : JSON.stringify(resize)
    ];
}

function writeBufferInChunks(writableStream, buffer) {
    const asString = buffer.toString("base64");

    const INCREMENT = 1024;

    for (let offset = 0; offset < asString.length; offset += INCREMENT) {
        writableStream.write(asString.substring(offset, offset + INCREMENT));
    }
    writableStream.write("\n"); // so that the PhantomJS side can use readLine()
}

function processResult(result) {
    const stdout = result.stdout.toString();
    if (stdout.startsWith(PREFIX)) {
        return new Buffer(stdout.substring(PREFIX.length), "base64");
    }

    if (stdout.length > 0) {
         // PhantomJS always outputs to stdout.
         throw new Error(stdout.replace(/\r/g, "").trim());
    }

    const stderr = result.stderr.toString();
    if (stderr.length > 0) {
        // But hey something else might get to stderr.
        throw new Error(stderr.replace(/\r/g, "").trim());
    }

    throw new Error("No data received from the PhantomJS child process");
}
