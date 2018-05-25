"use strict";

var Stream              //no dependencies
   ,Util                //depands on [Stream]
   ,Lzjb                //depands on [Stream, Util(Stream)]
   ;


Stream = (function(){
/** Abstract Stream interface, for byte-oriented i/o. */
var EOF = -1;

var Stream = function() {
  /* ABSTRACT */
};
// you must define one of read / readByte for a readable stream
Stream.prototype.readByte = function() {
  var buf = [0];
  var len = this.read(buf, 0, 1);
  if (len === 0) { this._eof = true; return EOF; }
  return buf[0];
};
Stream.prototype.read = function(buf, bufOffset, length) {
  var ch, bytesRead = 0;
  while (bytesRead < length) {
    ch = this.readByte();
    if (ch === EOF) { this._eof = true; break; }
    buf[bufOffset + (bytesRead++)] = ch;
  }
  return bytesRead;
};
Stream.prototype.eof = function() { return !!this._eof; };    // reasonable default implementation of 'eof'
Stream.prototype.seek = function(pos) {                       // not all readable streams are seekable
  throw new Error('Stream is not seekable.');
};
Stream.prototype.tell = function() {
  throw new Error('Stream is not seekable.');
};
Stream.prototype.writeByte = function(_byte) {    // you must define one of write / writeByte for a writable stream
  var buf = [_byte];
  this.write(buf, 0, 1);
};
Stream.prototype.write = function(buf, bufOffset, length) {
  var i;
  for (i = 0; i < length; i++) {
    this.writeByte(buf[bufOffset + i]);
  }
  return length;
};
Stream.prototype.flush = function(){};      //flush will happily do nothing if you don't override it.
Stream.EOF = EOF;                           //export EOF as a constant.

return Stream;
}());


Util = (function(){
var Util = Object.create(null);

var EOF = Stream.EOF;

/* Take a buffer, array, or stream, and return an input stream. */
Util.coerceInputStream = function(input, forceRead) {
  if (!('readByte' in input)) {
    var buffer = input;
    input = new Stream();
    input.size = buffer.length;
    input.pos = 0;
    input.readByte = function() {
      if (this.pos >= this.size) { return EOF; }
      return buffer[this.pos++];
    };
    input.read = function(buf, bufOffset, length) {
      var bytesRead = 0;
      while (bytesRead < length && this.pos < buffer.length) {
        buf[bufOffset++] = buffer[this.pos++];
        bytesRead++;
      }
      return bytesRead;
    };
    input.seek = function(pos) { this.pos = pos; };
    input.tell = function() { return this.pos; };
    input.eof = function() { return this.pos >= buffer.length; };
  } else if (forceRead && !('read' in input)) {
    // wrap input if it doesn't implement read
    var s = input;
    input = new Stream();
    input.readByte = function() {
      var ch = s.readByte();
      if (ch === EOF) { this._eof = true; }
      return ch;
    };
    if ('size' in s) { input.size = s.size; }
    if ('seek' in s) {
      input.seek = function(pos) {
        s.seek(pos); // may throw if s doesn't implement seek
        this._eof = false;
      };
    }
    if ('tell' in s) {
      input.tell = s.tell.bind(s);
    }
  }
  return input;
};

var BufferStream = function(buffer, resizeOk) {
  this.buffer = buffer;
  this.resizeOk = resizeOk;
  this.pos = 0;
};
BufferStream.prototype = Object.create(Stream.prototype);
BufferStream.prototype.writeByte = function(_byte) {
  if (this.resizeOk && this.pos >= this.buffer.length) {
    var newBuffer = Util.makeU8Buffer(this.buffer.length * 2);
    newBuffer.set(this.buffer);
    this.buffer = newBuffer;
  }
  this.buffer[this.pos++] = _byte;
};
BufferStream.prototype.getBuffer = function() {
  // trim buffer if needed
  if (this.pos !== this.buffer.length) {
    if (!this.resizeOk)
      throw new TypeError('outputsize does not match decoded input');
    var newBuffer = Util.makeU8Buffer(this.pos);
    newBuffer.set(this.buffer.subarray(0, this.pos));
    this.buffer = newBuffer;
  }
  return this.buffer;
};

/* Take a stream (or not) and an (optional) size, and return an
 * output stream.  Return an object with a 'retval' field equal to
 * the output stream (if that was given) or else a pointer at the
 * internal Uint8Array/buffer/array; and a 'stream' field equal to
 * an output stream to use.
 */
Util.coerceOutputStream = function(output, size) {
  var r = { stream: output, retval: output };
  if (output) {
    if (typeof(output) === 'object' && 'writeByte' in output) {
      return r; /* leave output alone */
    } else if (typeof(size) === 'number') {
      console.assert(size >= 0);
      r.stream = new BufferStream(Util.makeU8Buffer(size), false);
    } else { // output is a buffer
      r.stream = new BufferStream(output, false);
    }
  } else {
    r.stream = new BufferStream(Util.makeU8Buffer(16384), true);
  }
  Object.defineProperty(r, 'retval', {
    get: r.stream.getBuffer.bind(r.stream)
  });
  return r;
};

Util.compressFileHelper = function(magic, guts, suppressFinalByte) {
  return function(inStream, outStream, props) {
    inStream = Util.coerceInputStream(inStream);
    var o = Util.coerceOutputStream(outStream, outStream);
    outStream = o.stream;

    // write the magic number to identify this file type
    // (it better be ASCII, we're not doing utf-8 conversion)
    var i;
    for (i = 0; i < magic.length; i++) {
      outStream.writeByte(magic.charCodeAt(i));
    }

    // if we know the size, write it
    var fileSize;
    if ('size' in inStream && inStream.size >= 0) {
      fileSize = inStream.size;
    } else {
      fileSize = -1; // size unknown
    }
    if (suppressFinalByte) {
      var tmpOutput = Util.coerceOutputStream([]);
      Util.writeUnsignedNumber(tmpOutput.stream, fileSize + 1);
      tmpOutput = tmpOutput.retval;
      for (i = 0; i < tmpOutput.length - 1; i++) {
        outStream.writeByte(tmpOutput[i]);
      }
      suppressFinalByte = tmpOutput[tmpOutput.length - 1];
    } else {
      Util.writeUnsignedNumber(outStream, fileSize + 1);
    }

    // call the guts to do the real compression
    guts(inStream, outStream, fileSize, props, suppressFinalByte);

    return o.retval;
  };
};
Util.decompressFileHelper = function(magic, guts) {
  return function(inStream, outStream) {
    inStream = Util.coerceInputStream(inStream);

    // read the magic number to confirm this file type
    // (it better be ASCII, we're not doing utf-8 conversion)
    var i;
    for (i = 0; i < magic.length; i++) {
      if (magic.charCodeAt(i) !== inStream.readByte()) {
        throw new Error("Bad magic");
      }
    }

    // read the file size & create an appropriate output stream/buffer
    var fileSize = Util.readUnsignedNumber(inStream) - 1;
    var o = Util.coerceOutputStream(outStream, fileSize);
    outStream = o.stream;

    // call the guts to do the real decompression
    guts(inStream, outStream, fileSize);

    return o.retval;
  };
};
// a helper for simple self-test of model encode
Util.compressWithModel = function(inStream, fileSize, model) {
  var inSize = 0;
  while (inSize !== fileSize) {
    var ch = inStream.readByte();
    if (ch === EOF) {
      model.encode(256); // end of stream;
      break;
    }
    model.encode(ch);
    inSize++;
  }
};
// a helper for simple self-test of model decode
Util.decompressWithModel = function(outStream, fileSize, model) {
  var outSize = 0;
  while (outSize !== fileSize) {
    var ch = model.decode();
    if (ch === 256) {
      break; // end of stream;
    }
    outStream.writeByte(ch);
    outSize++;
  }
};

/** Write a number using a self-delimiting big-endian encoding. */
Util.writeUnsignedNumber = function(output, n) {
  console.assert(n >= 0);
  var bytes = []
    , i;
  do {
    bytes.push(n & 0x7F);
    // use division instead of shift to allow encoding numbers up to
    // 2^53
    n = Math.floor(n / 128);
  } while (n !== 0);
  bytes[0] |= 0x80; // mark end of encoding.
  for (i = bytes.length - 1; i >= 0; i--) {
    output.writeByte(bytes[i]); // write in big-endian order
  }
  return output;
};

/** Read a number using a self-delimiting big-endian encoding. */
Util.readUnsignedNumber = function(input) {
  var n = 0
    , c;
  while (true) {
    c = input.readByte();
    if (c & 0x80) { n += (c & 0x7F); break; }
    // using + and * instead of << allows decoding numbers up to 2^53
    n = (n + c) * 128;
  }
  return n;
};

// Compatibility thunks for Buffer/TypedArray constructors.

var zerofill = function(a) {
  for (var i = 0, len = a.length; i < len; i++) {
    a[i] = 0;
  }
  return a;
};

var fallbackarray = function(size) {
  return zerofill(new Array(size));
};

// Node 0.11.6 - 0.11.10ish don't properly zero fill typed arrays.
// See https://github.com/joyent/node/issues/6664
// Try to detect and workaround the bug.
var ensureZeroed = function id(a) { return a; };
if ((typeof(process) !== 'undefined') &&
  Array.prototype.some.call(new Uint32Array(128), function(x) {
    return x !== 0;
  })) {
  //console.warn('Working around broken TypedArray');
  ensureZeroed = zerofill;
}

/** Portable 8-bit unsigned buffer. */
Util.makeU8Buffer = (typeof(Uint8Array) !== 'undefined') ? function(size) {
  // Uint8Array ought to be  automatically zero-filled
  return ensureZeroed(new Uint8Array(size));
} : (typeof(Buffer) !== 'undefined') ? function(size) {
  var b = new Buffer(size);
  b.fill(0);
  return b;
} : fallbackarray;

/** Portable 16-bit unsigned buffer. */
Util.makeU16Buffer = (typeof(Uint16Array) !== 'undefined') ? function(size) {
  // Uint16Array ought to be  automatically zero-filled
  return ensureZeroed(new Uint16Array(size));
} : fallbackarray;

/** Portable 32-bit unsigned buffer. */
Util.makeU32Buffer = (typeof(Uint32Array) !== 'undefined') ? function(size) {
  // Uint32Array ought to be  automatically zero-filled
  return ensureZeroed(new Uint32Array(size));
} : fallbackarray;

/** Portable 32-bit signed buffer. */
Util.makeS32Buffer = (typeof(Int32Array) !== 'undefined') ? function(size) {
  // Int32Array ought to be  automatically zero-filled
  return ensureZeroed(new Int32Array(size));
} : fallbackarray;

Util.arraycopy = function(dst, src) {
  console.assert(dst.length >= src.length);
  for (var i = 0, len = src.length; i < len; i++) {
    dst[i] = src[i];
  }
  return dst;
};

/** Highest bit set in a byte. */
var bytemsb = [
        0
       ,1
       ,2, 2
       ,3, 3, 3, 3
       ,4, 4, 4, 4, 4, 4, 4, 4
       ,5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5
       ,6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6
       ,7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7
       ,8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8 /* 256 */
    ];
console.assert(bytemsb.length === 0x100);
/** Find last set (most significant bit).
 *  @return the last bit set in the argument.
 *          <code>fls(0)==0</code> and <code>fls(1)==1</code>. */
var fls = Util.fls = function(v) {
  console.assert(v >= 0);
  if (v > 0xFFFFFFFF) { // use floating-point mojo
    return 32 + fls(Math.floor(v / 0x100000000));
  }
  if ((v & 0xFFFF0000) !== 0) {
    if ((v & 0xFF000000) !== 0) {
      return 24 + bytemsb[(v >>> 24) & 0xFF];
    } else {
      return 16 + bytemsb[v >>> 16];
    }
  } else if ((v & 0x0000FF00) !== 0) {
    return 8 + bytemsb[v >>> 8];
  } else {
    return bytemsb[v];
  }
};
/** Returns ceil(log2(n)) */
Util.log2c = function(v) {
  return (v === 0) ? -1 : fls(v - 1);
};

return Util; // ensure constants are recognized as such.
}());


Lzjb = (function(){
/* LZJB compression: http://en.wikipedia.org/wiki/LZJB */
/**
$Id: Iuppiter.js 3026 2010-06-23 10:03:13Z Bear $

Copyright (c) 2010 Nuwa Information Co., Ltd, and individual contributors.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

  1. Redistributions of source code must retain the above copyright notice,
     this list of conditions and the following disclaimer.

  2. Redistributions in binary form must reproduce the above copyright
     notice, this list of conditions and the following disclaimer in the
     documentation and/or other materials provided with the distribution.

  3. Neither the name of Nuwa Information nor the names of its contributors
     may be used to endorse or promote products derived from this software
     without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

$Author: Bear $
$Date: 2010-06-23 18:03:13 +0800 (星期三, 23 六月 2010) $
$Revision: 3026 $
*/

var Lzjb = Object.create(null);
Lzjb.MAGIC = 'lzjb';

// Constants was used for compress/decompress function.
var NBBY = 8
  , MATCH_BITS = 6
  , MATCH_MIN = 3
  , MATCH_MAX = ((1 << MATCH_BITS) + (MATCH_MIN - 1))
  , OFFSET_MASK = ((1 << (16 - MATCH_BITS)) - 1)
  , LEMPEL_SIZE_BASE = 1024;
var EOF = Stream.EOF;

// set C_COMPAT to true if you need to decompress with the (untweaked) C lzjb
// implementation, which breaks if offset==0; the javascript
// implementation uses 0 to indicate an offset of OFFSET_MASK+1.
var C_COMPAT = true;

/**
 * Compress string or byte array using fast and efficient algorithm.
 *
 * Because of weak of javascript's natural, many compression algorithm
 * become useless in javascript implementation. The main problem is
 * performance, even the simple Huffman, LZ77/78 algorithm will take many
 * many time to operate. We use LZJB algorithm to do that, it suprisingly
 * fulfills our requirement to compress string fastly and efficiently.
 *
 * Our implementation is based on
 * http://src.opensolaris.org/source/raw/onnv/onnv-gate/usr/src/uts/common/fs/zfs/lzjb.c
 * and
 * http://src.opensolaris.org/source/raw/onnv/onnv-gate/usr/src/uts/common/os/compress.c
 * It is licensed under CDDL.
 *
 * @param {Array|Uint8Array|Buffer|stream} input The stream or byte array
 *        that you want to compress.
 * @param {stream} output Optional output stream.
 * @return {Array|Uint8Array|Buffer} Compressed byte array, or 'output'
 */
Lzjb.compressFile = Util.compressFileHelper(Lzjb.MAGIC, function(inStream, outStream, fileSize, props) {
  var sstart, dstart = []
    , slen
    , src = 0
    , dst = 0
    , cpy, copymap
    , mlen, offset
    , hash, hp
    , lempel
    , i, j;
  var retval;

  // in an improvement over the original C implementation, we expand
  // the hash table to track a number of potential matches, not just the
  // most recent.  This doesn't require any changes to the decoder.
  // Sample impact on compression size (on wikipedia data):
  //  EXPAND  Time     Size      Option
  //    1   0m20.321s  50185613    -1
  //    2   0m22.437s  46503301    -2
  //    3   0m23.773s  45744564    -3
  //    4   0m25.666s  45199866    -4
  //    5   0m35.810s  44821413    -5
  //    6   0m40.947s  44666638    -6
  //    8   0m49.639s  44413865    -7
  //   12   0m49.927s  44124825    -8
  //   16   1m01.180s  43972515    -9
  //   32   1m30.530s  43554099
  //   64   2m14.504s  43005530
  //  128   3m43.570s  42361718
  //  256   6m38.681s  41684853
  var LEMPEL_SIZE = LEMPEL_SIZE_BASE;
  var EXPAND = 1; // default to original C impl
  if (typeof(props) === 'number') {
    LEMPEL_SIZE *= 2;
    props = Math.max(1, Math.min(9, props)) - 1;
    EXPAND = 1 << Math.floor(props / 2);
    if (props & 1) EXPAND = Math.round(EXPAND * 1.5);
    if (props >= 2 && props <= 4) EXPAND++;
  }

  // use Uint16Array if available (zero-filled)
  lempel = Util.makeU16Buffer(LEMPEL_SIZE * EXPAND);

  var window = Util.makeU8Buffer(OFFSET_MASK + 1);
  var windowpos = 0;
  var winput = function(_byte) {
    window[windowpos++] = _byte;
    if (windowpos >= window.length) {
      windowpos = 0;
    }
    return _byte;
  };

  var outwindow = Util.makeU8Buffer(17);
  var outpos = 0;
  var dumpout = function() {
    var i;
    for (i = 0; i < outpos; i++) {
      outStream.writeByte(outwindow[i]);
    }
    outpos = 0;
  };

  var unbuffer = [];
  var get = function() {
    if (unbuffer.length)
      return unbuffer.pop();
    return inStream.readByte();
  };
  var unget = function(_byte) {
    unbuffer.push(_byte);
  };

  var copymask = 1 << (NBBY - 1);
  var matchpossibility = [];
  while (true) {
    var c1 = get();
    if (c1 === EOF) break;

    if ((copymask <<= 1) == (1 << NBBY)) {
      dumpout();
      copymask = 1;
      outwindow[0] = 0;
      outpos = 1;
    }

    var c2 = get();
    if (c2 === EOF) {
      outwindow[outpos++] = winput(c1);
      break;
    }
    var c3 = get();
    if (c3 === EOF) {
      outwindow[outpos++] = winput(c1);
      unget(c2);
      continue;
    }

    hash = (c1 << 16) + (c2 << 8) + c3;
    hash ^= (hash >> 9);
    hash += (hash >> 5);
    hash ^= c1;
    hp = (hash & (LEMPEL_SIZE - 1)) * EXPAND;
    matchpossibility.length = 0;
    for (j = 0; j < EXPAND; j++) {
      offset = (windowpos - lempel[hp + j]) & OFFSET_MASK;
      cpy = window.length + windowpos - offset;
      var w1 = window[cpy & OFFSET_MASK];
      var w2 = window[(cpy + 1) & OFFSET_MASK];
      var w3 = window[(cpy + 2) & OFFSET_MASK];
      // if offset is small, we might not have copied the tentative
      // bytes into the window yet.  (Note that offset=0 really means
      // offset=(OFFSET_MASK+1).)
      if (C_COMPAT && offset === 0) {
        w1 = c1 ^ 1; // ensure match will fail
      } else if (offset == 1) { w2 = c1;
        w3 = c2; } else if (offset == 2) { w3 = c1; }
      if (c1 === w1 && c2 === w2 && c3 === w3) {
        matchpossibility.push(offset);
      }
    }
    // store this location in the hash, move the others over to make room
    // oldest match drops off
    for (j = EXPAND - 1; j > 0; j--)
      lempel[hp + j] = lempel[hp + j - 1];
    lempel[hp] = windowpos;
    // did we find any matches?
    if (matchpossibility.length === 0) {
      outwindow[outpos++] = winput(c1);
      unget(c3);
      unget(c2);
    } else {
      // find the longest of the possible matches
      outwindow[0] |= copymask;
      winput(c1);
      winput(c2);
      winput(c3);
      var c4 = get()
        , last = matchpossibility[0];
      var base = window.length + windowpos;
      for (mlen = MATCH_MIN; mlen < MATCH_MAX; mlen++, base++) {
        if (c4 === EOF) break;
        for (j = 0; j < matchpossibility.length;) {
          var w4 = window[(base - matchpossibility[j]) & OFFSET_MASK];
          if (c4 !== w4) {
            last = matchpossibility[j];
            matchpossibility.splice(j, 1);
          } else {
            j++;
          }
        }
        if (matchpossibility.length === 0) break; // no more matches
        winput(c4);
        c4 = get();
      }
      if (matchpossibility.length !== 0) {
        // maximum length match, rock on!
        last = matchpossibility[0];
      }
      unget(c4);

      outwindow[outpos++] = ((mlen - MATCH_MIN) << (NBBY - MATCH_BITS)) |
        (last >> NBBY);
      outwindow[outpos++] = last & 0xFF;
    }
  }
  dumpout();
});

/**
 * Decompress string or byte array using fast and efficient algorithm.
 *
 * Our implementation is based on
 * http://src.opensolaris.org/source/raw/onnv/onnv-gate/usr/src/uts/common/fs/zfs/lzjb.c
 * and
 * http://src.opensolaris.org/source/raw/onnv/onnv-gate/usr/src/uts/common/os/compress.c
 * It is licensed under CDDL.
 *
 * @param {Array|Uint8Array|Buffer|stream} input The stream or byte array
 *        that you want to decompress.
 * @param {stream} output Optional output stream.
 * @return {Array|Uint8Array|Buffer} Decompressed byte array, or 'output'
 */
Lzjb.decompressFile = Util.decompressFileHelper(Lzjb.MAGIC, function(inStream, outStream, outSize) {
  var sstart, dstart = []
    , slen
    , src = 0
    , dst = 0
    , cpy, copymap
    , mlen, offset
    , i, c;
  var retval;

  var window = Util.makeU8Buffer(OFFSET_MASK + 1);
  var windowpos = 0;

  var copymask = 1 << (NBBY - 1);

  while (outSize !== 0) {
    c = inStream.readByte();
    if (c === EOF) break;

    if ((copymask <<= 1) == (1 << NBBY)) {
      copymask = 1;
      copymap = c;
      c = inStream.readByte();
    }
    if (copymap & copymask) {
      mlen = (c >> (NBBY - MATCH_BITS)) + MATCH_MIN;
      offset = ((c << NBBY) | inStream.readByte()) & OFFSET_MASK;
      cpy = windowpos - offset;
      if (cpy < 0) cpy += window.length;
      if (outSize >= 0) outSize -= mlen;
      while (--mlen >= 0) {
        c = window[windowpos++] = window[cpy++];
        outStream.writeByte(c);
        if (windowpos >= window.length) { windowpos = 0; }
        if (cpy >= window.length) { cpy = 0; }
      }
    } else {
      outStream.writeByte(c);
      window[windowpos++] = c;
      if (windowpos >= window.length) { windowpos = 0; }
      if (outSize >= 0) outSize--;
    }
  }
});


return Lzjb;
}());

