# compressjs-flattened 

single file per compression algorithm, with all the dependencies. 

no require, no amdefine, no define and no freeze. 

closure-compiler/uglifier compatible. 

copy-paste to browser's console will work too. 

will work fine both on main-thread or a worker.

license is GnuV2 as-in compressjs project. 

<hr/>

note #1:
the compress method will accept various kinds of arrays..
but you can work with UTF-8, array-buffer and base64 to normalize the input, by encoding it to base64.

```js
  s = unescape(encodeURIComponent(s));         //to binary-string.
  s = btoa(s);                                 //to BASE64.
  s = (new TextEncoder("utf-8")).encode(s);    //to Uint8Array.
```

if you want to move a large-amount of data to worker/client, one more step to convert the data to an array buffer will allow the browser to avoid copying the data, in-favor of a much more efficient "context-switch" (see note #2 below..):
  s = s.buffer;                                //to ArrayBuffer.

to get the string back

```js
  s = (new TextDecoder("utf-8")).decode(buffer); //to text (binary string) - still base64 encoded.
  s = atob(s);                                   //from BASE64.
  s = decodeURIComponent(escape(s));             //from binary-string to UTF-8 capable string.
```

<hr/>

note #2:
If you do place the code in a worker,
or load it into a worker (which is a reasonable way of work),
<strong>do try</strong> passing the result as an array buffer to the client,
it is called a context-switch, and is quite efficient way of transferring data from worker to main-thread,
it is quite easy and will fallback on simply copying in-case the browser won't support it,
only thing you have to do is to add the variable after the <code>{}</code> part as argument #2 of postMessage back to client:

```js
var result = ....array buffer...
self.postMessage({"the_result":result}, result)
```

you can see an example on how to use it in <a href="https://github.com/eladkarako/base64/blob/master/reader.js#L27">github.com/eladkarako/base64 - reader.js (Line 27)</a>.



<hr/>
<br/>
<br/>
<br/>
the <a href="https://github.com/cscott/compressjs">compressjs</a> <a href="https://github.com/cscott/compressjs/blob/master/README.md">README.md</a> file:
<br/>
# compressjs
[![NPM][NPM1]][NPM2]

[![Build Status][1]][2] [![dependency status][3]][4] [![dev dependency status][5]][6]

`compressjs` contains fast pure-JavaScript implementations of various
de/compression algorithms, including `bzip2`, Charles Bloom's
[LZP3](http://www.cbloom.com/papers/lzp.pdf),
a modified
[LZJB](http://en.wikipedia.org/wiki/LZJB),
`PPM-D`, and an implementation of
[Dynamic Markov Compression](http://en.wikipedia.org/wiki/Dynamic_Markov_Compression).
`compressjs` is written by C. Scott Ananian.
The Range Coder used is a JavaScript port of
[Michael Schindler's C range coder](http://www.compressconsult.com/rangecoder).
Bits also also borrowed from Yuta Mori's
[SAIS implementation](https://sites.google.com/site/yuta256/sais);
[Eli Skeggs](https://github.com/skeggse/node-bzip),
[Kevin Kwok](https://github.com/antimatter15/bzip2.js),
[Rob Landley](http://www.landley.net/code/bunzip-4.1.c),
[James Taylor](https://bitbucket.org/james_taylor/seek-bzip2/),
and [Matthew Francis](https://code.google.com/p/jbzip2)
for Bzip2 compression and decompression code.
"Bear" wrote the [original JavaScript LZJB](https://code.google.com/p/jslzjb/);
the version here is based on the
[node lzjb module](https://github.com/cscott/lzjb).

## Compression benchmarks
Here are some representative speeds and sizes for the various algorithms
implemented in this package.  Times are with node 0.8.22 on my laptop, but
they should be valid for inter-algorithm comparisons.

### test/sample5.ref
This is the [Taoism](http://simple.wikipedia.org/wiki/Taoism) article from
the [Simple English wikipedia](http://simple.wikipedia.org), in HTML
format as generated by the Wikipedia
[Parsoid](http://www.mediawiki.org/wiki/Parsoid) project.

|Type|Level|Size (bytes)|Compress time (s)|Decompress time (s)|
|----|:---:|-----------:|----------------:|------------------:|
|bwtc    |9| 272997|13.10| 1.85|
|bzip2   |9| 275087|22.57| 1.21|
|lzp3    |-| 292978| 1.73| 1.74|
|ppm     |-| 297220|42.05|44.04|
|bzip2   |1| 341615|22.63| 1.40|
|bwtc    |1| 345764|12.34| 0.80|
|dmc     |-| 434182| 6.97| 9.00|
|lzjbr   |9| 491476| 3.19| 1.92|
|lzjbr   |1| 523780| 2.76| 2.02|
|lzjb    |9| 706210| 1.02| 0.30|
|lzjb    |1| 758467| 0.66| 0.29|
|context1|-| 939098| 5.20| 4.69|
|fenwick |-|1440645| 3.06| 3.72|
|mtf     |-|1441763| 1.92| 3.86|
|huffman |-|1452055| 7.15| 6.56|
|simple  |-|1479143| 0.72| 2.42|
|defsum  |-|1491107| 3.19| 1.46|
|no      |-|2130648| 0.80| 0.92|
|-       |-|2130640|-    |-    |

### enwik8
This test data is the first 10<sup>8</sup> bytes of the English Wikipedia
XML dump on March 3, 2006.  This is the data set used for the
[Large Text Compression Benchmark](http://mattmahoney.net/dc/text.html).
It can be downloaded [from that site](http://mattmahoney.net/dc/textdata.html).

|Type|Level|Size (bytes)|Compress time (s)|Decompress time (s)|
|----|:---:|-----------:|----------------:|------------------:|
|ppm     |-|    26560169|2615.82|2279.17|
|bzip2   |9|    28995650|1068.51|  66.95|
|bwtc    |9|    29403626| 618.63| 112.00|
|bzip2   |1|    33525893|1035.29|  66.98|
|lzp3    |-|    34305420| 123.69| 167.77|
|bwtc    |1|    34533422| 618.61|  43.52|
|lzjbr   |9|    43594841| 242.60| 141.51|
|lzjbr   |1|    44879071| 207.38| 147.14|
|context1|-|    48480225| 253.48| 223.30|
|huffman |-|    62702157| 301.50| 267.31|
|fenwick |-|    62024449| 143.49| 164.15|
|mtf     |-|    62090746|  83.62| 168.03|
|simple  |-|    63463479|  27.79|  92.84|
|defsum  |-|    64197615|  75.48|  32.05|
|lzjb    |9|    64992459|  63.75|   5.90|
|lzjb    |1|    67828511|  29.26|   5.89|
|no      |-|   100000008|  26.29|  31.98|
|-       |-|   100000000|      -|      -|

### Algorithm descriptions
* `compressjs.Bzip2` (`-t bzip2`) is the bzip2 algorithm we all have
  come to know and love.  It has a block size between 100k and 900k.
* `compressjs.BWTC` (`-t bwtc`) is substantially the same, but with a
  few simplifications/improvements which make it faster, smaller, and
  not binary-compatible.  In particular, the unnecessary initial RLE step
  of bzip2 is omitted, and we use a range coder with an adaptive
  context-0 model after the MTF/RLE2 step, instead of the static
  huffman codes of bzip2.
* `compressjs.PPM` (`-t ppm`) is a naive/simple implementation of the
  [PPMD](http://en.wikipedia.org/wiki/Prediction_by_partial_matching)
  algorithm with a 256k sliding window.
* `compressjs.Lzp3` (`-t lzp3`) is an algorithm similar to Charles
  Bloom's [LZP3](http://www.cbloom.com/papers/lzp.pdf) algorithm.
  It uses a 1M sliding window, a context-4 model, and a range coder.
* `compressjs.Dmc` (`-t dmc`) is a partial implementation of [Dynamic
  Markov Compression](http://en.wikipedia.org/wiki/Dynamic_Markov_compression).
  Unlike most DMC implementations, our implementation is bytewise (not
  bitwise).  There is currently no provision for shrinking the Markov
  model (or throwing it out when it grows too large), so be careful
  with large inputs!  I may return to twiddle with this some more; see
  the source for details.
* `compressjs.Lzjb` (`-t lzjb`) is a straight copy of the fast
  [LZJB](http://en.wikipedia.org/wiki/LZJB) algorithm from
  <https://github.com/cscott/lzjb>.
* `compressjs.LzjbR` (`-t lzjbr`) is a hacked version of LZJB which
  uses a range coder and a bit of modeling instead of the fixed
  9-bit literal / 17-bit match format of the original.

The remaining algorithms are self-tests for various bits of
compression code, not real compressors. `Context1Model` is a simple
adaptive context-1 model using a range coder.  `Huffman` is an
adaptive Huffman coder using [Vitter's algorithm][].
`MTFModel`, `FenwickModel`, and `DefSumModel` are simple adaptive
context-0 models with escapes, implementing using a move-to-front
list, a [Fenwick tree](http://en.wikipedia.org/wiki/Fenwick_tree), and
Charles Bloom's
[deferred summation algorithm](http://cbloom.com/papers/context.pdf),
respectively.  `Simple` is a static context-0 model for the range
coder.  `NoModel` encodes the input bits directly; it shows the
basic I/O overhead, as well as the few bytes of overhead due to the
[file magic][] and a variable-length encoding of the uncompressed size
of the file.

[Vitter's algorithm]: http://en.wikipedia.org/wiki/Adaptive_Huffman_coding#Vitter_algorithm
[file magic]:         http://en.wikipedia.org/wiki/Magic_number_%28programming%29#Magic_numbers_in_files

## How to install

```
npm install compressjs
```
or
```
volo add cscott/compressjs
```

This package uses
[Typed Arrays](https://developer.mozilla.org/en-US/docs/JavaScript/Typed_arrays)
if available, which are present in node.js >= 0.5.5 and many modern
browsers.  Full browser compatibility table
is available at [caniuse.com](http://caniuse.com/typedarrays); briefly:
IE 10, Firefox 4, Chrome 7, or Safari 5.1.

## Testing

```
npm install
npm test
```

## Usage

There is a binary available in bin:
```
$ bin/compressjs --help
$ echo "Test me" | bin/compressjs -t lzp3 -z > test.lzp3
$ bin/compressjs -t lzp3 -d test.lzp3
Test me
```

The `-t` argument can take a number of different strings to specify
the various compression algorithms available.  Use `--help` to see
the various options.

From JavaScript:
```
var compressjs = require('compressjs');
var algorithm = compressjs.Lzp3;
var data = new Buffer('Example data', 'utf8');
var compressed = algorithm.compressFile(data);
var decompressed = algorithm.decompressFile(compressed);
// convert from array back to string
var data2 = new Buffer(decompressed).toString('utf8');
console.log(data2);
```
There is a streaming interface as well.  Use `Uint8Array` or normal
JavaScript arrays when running in a browser.

See the tests in the `tests/` directory for further usage examples.

## Documentation

`require('compressjs')` returns a `compressjs` object.  Its fields
correspond to the various algorithms implemented, which export one of
two different interfaces, depending on whether it is a "compression
method" or a "model/coder".

### Compression Methods
Compression methods (like `compressjs.Lzp3`) export two methods.
The first is a function accepting one, two or three parameters:

`cmp.compressFile = function(input, [output], [Number compressionLevel] or [props])`

The `input` argument can be a "stream" object (which must implement the
`readByte` method), or a `Uint8Array`, `Buffer`, or array.

If you omit the second argument, `compressFile` will return a JavaScript
array containing the byte values of the compressed data.  If you pass
a second argument, it must be a "stream" object (which must implement the
`writeByte` method).

The third argument may be omitted, or a number between 1 and 9 indicating
a compression level (1 being largest/fastest compression and 9 being
smallest/slowest compression).  Some algorithms also permit passing
an object for finer-grained control of various compression properties.

The second exported method is a function accepting one or two parameters:

`cmp.decompressFile = function(input, [output])`

The `input` parameter is as above.

If you omit the second argument, `decompressFile` will return a
`Uint8Array`, `Buffer` or JavaScript array with the decompressed
data, depending on what your platform supports.  For most modern
platforms (modern browsers, recent node.js releases) the returned
value will be a `Uint8Array`.

If you provide the second argument, it must be a "stream", implementing
the `writeByte` method.

### Models and coders

The second type of object implemented is a model/coder.  `Huffman` and
`RangeCoder` share the same interface as the simple context-0 probability
models `MTFModel`, `FenwickModel`, `LogDistanceModel`, and
`DeflateDistanceModel`.

`model.factory = function(parameters)`

This method returns a function which can be invoked with a `size` argument to
create a new instance of this model with the given parameters (which usually
include the input/output stream or coder).

`model.encode = function(symbol, [optional context])`

This method encodes the given symbol, possibly with the given additional
context, and then updates the model or adaptive coder if necessary.
The symbol is usually in the range `[0, size)`, although some
models allow adding "extra symbols" to the possible range, which are
usually given negative values.  For example, you might want to create a
`LogDistanceModel` with one extra state to encode "same distance as the
last one encoded".

`model.decode = function([optional context])`

Decode the next symbol and updates the model or adaptive coder.
The values returned are usually in the range `[0, size]` although
negative numbers may be returned if you requested "extra symbols" when
you created the model.

## Related articles and projects

* http://en.wikipedia.org/wiki/Dynamic_Markov_Compression Wikipedia article on DMC
* http://www.cs.uvic.ca/~nigelh/Publications/DMC.pdf Original DMC paper
* http://www.compressconsult.com/rangecoder/ Range Coder implementation in C

## Other JavaScript compressors

* https://github.com/cscott/lzjb LZJB
* https://github.com/cscott/lzma-purejs LZMA
* https://github.com/cscott/seek-bzip random-access bzip2 decompression

## License (GPLv2)

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 2 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see http://www.gnu.org/licenses/.

[NPM1]: https://nodei.co/npm/compressjs.png
[NPM2]: https://nodei.co/npm/compressjs/

[1]: https://travis-ci.org/cscott/compressjs.png
[2]: https://travis-ci.org/cscott/compressjs
[3]: https://david-dm.org/cscott/compressjs.png
[4]: https://david-dm.org/cscott/compressjs
[5]: https://david-dm.org/cscott/compressjs/dev-status.png
[6]: https://david-dm.org/cscott/compressjs#info=devDependencies