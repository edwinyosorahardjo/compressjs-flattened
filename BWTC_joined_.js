"use strict";

var RangeCoder          //no dependencies
   ,Stream              //no dependencies
   ,BitStream           //depands on [Stream]
   ,Util                //depands on [Stream]
   ,BWT                 //depands on [Util(Stream)]
   ,LogDistanceModel    //depands on [Util(Stream)]
   ,NoModel             //depands on [Util(Stream),BitStream(Stream)]
   ,DefSumModel         //depands on [RangeCoder, Stream, Util(Stream)]
   ,FenwickModel        //depands on [RangeCoder, Stream, Util(Stream)]
   ,BWTC                //depands on [RangeCoder, Stream, BitStream(Stream), Util(Stream), BWT(Util(Stream)), LogDistanceModel(Util(Stream)), NoModel(Util(Stream),BitStream(Stream)), DefSumModel(RangeCoder, Stream, Util(Stream)), FenwickModel(RangeCoder, Stream, Util(Stream))]
   ;


RangeCoder = (function(){
/* Range Coder.  Inspired by rangecod.c from rngcod13.zip from
 *    http://www.compressconsult.com/rangecoder/
 * This JavaScript version is:
 *    Copyright (c) 2013 C. Scott Ananian.
 */
// Uses 32-bit integer math.  Hopefully the JavaScript runtime figures
// that out. ;)
// see https://github.com/kripken/emscripten/wiki/LLVM-Types-in-JavaScript
// for some hints on doing 32-bit unsigned match in JavaScript.
// One key is the use of ">>>0" to change a signed result to unsigned.
var CODE_BITS = 32;
var Top_value = Math.pow(2, CODE_BITS - 1);
var SHIFT_BITS = (CODE_BITS - 9);
var EXTRA_BITS = ((CODE_BITS - 2) % 8 + 1);
var Bottom_value = (Top_value >>> 8);

var MAX_INT = Math.pow(2, CODE_BITS) - 1;

/* it is highly recommended that the total frequency count is less  */
/* than 1 << 19 to minimize rounding effects.                       */
/* the total frequency count MUST be less than 1<<23                */


var RangeCoder = function(stream) {
  this.low = 0; /* low end of interval */
  this.range = Top_value; /* length of interval */
  this.buffer = 0; /* buffer for input/output */
  this.help = 0; /* bytes_to_follow / intermediate value */
  this.bytecount = 0; /* counter for output bytes */
  this.stream = stream;
};

/* Do the normalization before we need a defined state, instead of
 * after messing it up.  This simplifies starting and ending. */
var enc_normalize = function(rc, outputStream) {
  while (rc.range <= Bottom_value) { /* do we need renormalization? */
    if (rc.low < (0xFF << SHIFT_BITS)) { //no carry possible, so output
      outputStream.writeByte(rc.buffer);
      for (; rc.help; rc.help--)
        outputStream.writeByte(0xFF);
      rc.buffer = (rc.low >>> SHIFT_BITS) & 0xFF;
    } else if (rc.low & Top_value) { /* carry now, no future carry */
      outputStream.writeByte(rc.buffer + 1);
      for (; rc.help; rc.help--)
        outputStream.writeByte(0x00);
      rc.buffer = (rc.low >>> SHIFT_BITS) & 0xFF;
    } else {
      rc.help++;
      if (rc.help > MAX_INT)
        throw new Error("Too many bytes outstanding, " +
          "file too large!");
    }
    rc.range = (rc.range << 8) >>> 0; /*ensure result remains positive*/
    rc.low = ((rc.low << 8) & (Top_value - 1)) >>> 0; /* unsigned */
    rc.bytecount++;
  }
};

/* Start the encoder                                         */
/* c is written as the first byte in the datastream.
 * one could do w/o, but then you have an additional if per output byte */
RangeCoder.prototype.encodeStart = function(c, initlength) {
  this.low = 0;
  this.range = Top_value;
  this.buffer = c;
  this.help = 0;
  this.bytecount = initlength;
};

/* Encode a symbol using frequencies                         */
/* rc is the range coder to be used                          */
/* sy_f is the interval length (frequency of the symbol)     */
/* lt_f is the lower end (frequency sum of < symbols)        */
/* tot_f is the total interval length (total frequency sum)  */
/* or (faster): tot_f = (code_value)1<<shift                             */
RangeCoder.prototype.encodeFreq = function(sy_f, lt_f, tot_f) {
  enc_normalize(this, this.stream);
  var r = (this.range / tot_f) >>> 0; // note coercion to integer
  var tmp = r * lt_f;
  this.low += tmp;
  if ((lt_f + sy_f) < tot_f) {
    this.range = r * sy_f;
  } else {
    this.range -= tmp;
  }
};
RangeCoder.prototype.encodeShift = function(sy_f, lt_f, shift) {
  enc_normalize(this, this.stream);
  var r = this.range >>> shift;
  var tmp = r * lt_f;
  this.low += tmp;
  if ((lt_f + sy_f) >>> shift) {
    this.range -= tmp;
  } else {
    this.range = r * sy_f;
  }
};
/* Encode a bit w/o modelling. */
RangeCoder.prototype.encodeBit = function(b) {
  this.encodeShift(1, b ? 1 : 0, 1);
};
/* Encode a byte w/o modelling. */
RangeCoder.prototype.encodeByte = function(b) {
  this.encodeShift(1, b, 8);
};
/* Encode a short w/o modelling. */
RangeCoder.prototype.encodeShort = function(s) {
  this.encodeShift(1, s, 16);
};

/* Finish encoding                                           */
/* returns number of bytes written                           */
RangeCoder.prototype.encodeFinish = function() {
  var outputStream = this.stream;
  enc_normalize(this, outputStream);
  this.bytecount += 5;
  var tmp = this.low >>> SHIFT_BITS;
  if ((this.low & (Bottom_value - 1)) >= ((this.bytecount & 0xFFFFFF) >>> 1)) {
    tmp++;
  }
  if (tmp > 0xFF) { /* we have a carry */
    outputStream.writeByte(this.buffer + 1);
    for (; this.help; this.help--)
      outputStream.writeByte(0x00);
  } else { /* no carry */
    outputStream.writeByte(this.buffer);
    for (; this.help; this.help--)
      outputStream.writeByte(0xFF);
  }
  outputStream.writeByte(tmp & 0xFF);
  // XXX: i'm pretty sure these could be three arbitrary bytes
  //      they are consumed by the decoder at the end
  outputStream.writeByte((this.bytecount >>> 16) & 0xFF);
  outputStream.writeByte((this.bytecount >>> 8) & 0xFF);
  outputStream.writeByte((this.bytecount) & 0xFF);
  return this.bytecount;
};

/* Start the decoder; you need to provide the *second* byte from the
 * datastream. (The first byte was provided to startEncoding and is
 * ignored by the decoder.)
 */
RangeCoder.prototype.decodeStart = function(skipInitialRead) {
  var c = skipInitialRead ? 0 : this.stream.readByte();
  if (typeof(c) !== 'number' || c < 0) {
    return c; // EOF
  }
  this.buffer = this.stream.readByte();
  this.low = this.buffer >>> (8 - EXTRA_BITS);
  this.range = 1 << EXTRA_BITS;
  return c;
};

var dec_normalize = function(rc, inputStream) {
  while (rc.range <= Bottom_value) {
    rc.low = (rc.low << 8) | ((rc.buffer << EXTRA_BITS) & 0xFF);
    /* rc.low could be negative here; don't fix it quite yet */
    rc.buffer = inputStream.readByte();
    rc.low |= rc.buffer >>> (8 - EXTRA_BITS);
    rc.low = rc.low >>> 0; /* fix it now */
    rc.range = (rc.range << 8) >>> 0; /* ensure stays positive */
  }
};

/* Calculate cumulative frequency for next symbol. Does NO update!*/
/* rc is the range coder to be used                          */
/* tot_f is the total frequency                              */
/* or: totf is (code_value)1<<shift                                      */
/* returns the <= cumulative frequency                         */
RangeCoder.prototype.decodeCulFreq = function(tot_f) {
  dec_normalize(this, this.stream);
  this.help = (this.range / tot_f) >>> 0; // note coercion to integer
  var tmp = (this.low / this.help) >>> 0; // again
  return (tmp >= tot_f ? tot_f - 1 : tmp);
};
RangeCoder.prototype.decodeCulShift = function(shift) {
  dec_normalize(this, this.stream);
  this.help = this.range >>> shift;
  var tmp = (this.low / this.help) >>> 0; // coercion to unsigned
  // shift is less than 31, so shift below will remain positive
  return ((tmp >>> shift) ? (1 << shift) - 1 : tmp);
};

/* Update decoding state                                     */
/* rc is the range coder to be used                          */
/* sy_f is the interval length (frequency of the symbol)     */
/* lt_f is the lower end (frequency sum of < symbols)        */
/* tot_f is the total interval length (total frequency sum)  */
RangeCoder.prototype.decodeUpdate = function(sy_f, lt_f, tot_f) {
  var tmp = this.help * lt_f; // should not overflow!
  this.low -= tmp;
  if (lt_f + sy_f < tot_f) {
    this.range = (this.help * sy_f);
  } else {
    this.range -= tmp;
  }
};

/* Decode a bit w/o modelling. */
RangeCoder.prototype.decodeBit = function() {
  var tmp = this.decodeCulShift(1);
  this.decodeUpdate(1, tmp, 1 << 1);
  return tmp;
};
/* decode a byte w/o modelling */
RangeCoder.prototype.decodeByte = function() {
  var tmp = this.decodeCulShift(8);
  this.decodeUpdate(1, tmp, 1 << 8);
  return tmp;
};
/* decode a short w/o modelling */
RangeCoder.prototype.decodeShort = function() {
  var tmp = this.decodeCulShift(16);
  this.decodeUpdate(1, tmp, 1 << 16);
  return tmp;
};

/* Finish decoding */
RangeCoder.prototype.decodeFinish = function() {
  /* normalize to use up all bytes */
  dec_normalize(this, this.stream);
};

/** Utility functions */

// bitstream interface
RangeCoder.prototype.writeBit = RangeCoder.prototype.encodeBit;
RangeCoder.prototype.readBit = RangeCoder.prototype.decodeBit;

// stream interface
RangeCoder.prototype.writeByte = RangeCoder.prototype.encodeByte;
RangeCoder.prototype.readByte = RangeCoder.prototype.decodeByte;

return RangeCoder;

}());


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


BitStream = (function(){
/** Big-Endian Bit Stream, implemented on top of a (normal byte) stream. */
var BitStream = function(stream) {
  (function() {
    var bufferByte = 0x100; // private var for readers
    this.readBit = function() {
      if ((bufferByte & 0xFF) === 0) {
        var ch = stream.readByte();
        if (ch === Stream.EOF) {
          this._eof = true;
          return ch; /* !!! */
        }
        bufferByte = (ch << 1) | 1;
      }
      var bit = (bufferByte & 0x100) ? 1 : 0;
      bufferByte <<= 1;
      return bit;
    };
    // seekable iff the provided stream is
    this.seekBit = function(pos) {
      var n_byte = pos >>> 3;
      var n_bit = pos - (n_byte * 8);
      this.seek(n_byte);
      this._eof = false;
      this.readBits(n_bit);
    };
    this.tellBit = function() {
      var pos = stream.tell() * 8;
      var b = bufferByte;
      while ((b & 0xFF) !== 0) {
        pos--;
        b <<= 1;
      }
      return pos;
    };
    // implement byte stream interface as well.
    this.readByte = function() {
      if ((bufferByte & 0xFF) === 0) {
        return stream.readByte();
      }
      return this.readBits(8);
    };
    this.seek = function(pos) {
      stream.seek(pos);
      bufferByte = 0x100;
    };
  })
  .call(this);
  (function() {
    var bufferByte = 1; // private var for writers
    this.writeBit = function(b) {
      bufferByte <<= 1;
      if (b) { bufferByte |= 1; }
      if (bufferByte & 0x100) {
        stream.writeByte(bufferByte & 0xFF);
        bufferByte = 1;
      }
    };
    // implement byte stream interface as well
    this.writeByte = function(_byte) {
      if (bufferByte === 1) {
        stream.writeByte(_byte);
      } else {
        stream.writeBits(8, _byte);
      }
    };
    this.flush = function() {
      while (bufferByte !== 1) {
        this.writeBit(0);
      }
      if (stream.flush) { stream.flush(); }
    };
  })
  .call(this);
};
// inherit read/write methods from Stream.
BitStream.EOF = Stream.EOF;
BitStream.prototype = Object.create(Stream.prototype);
// bit chunk read/write
BitStream.prototype.readBits = function(n) {
  var i, r = 0
    , b;
  if (n > 31) {
    r = this.readBits(n - 16) * 0x10000; // fp multiply, not shift
    return r + this.readBits(16);
  }
  for (i = 0; i < n; i++) {
    r <<= 1; // this could make a negative value if n>31
    // bits read past EOF are all zeros!
    if (this.readBit() > 0) { r++; }
  }
  return r;
};
BitStream.prototype.writeBits = function(n, value) {
  if (n > 32) {
    var low = (value & 0xFFFF);
    var high = (value - low) / (0x10000); // fp division, not shift
    this.writeBits(n - 16, high);
    this.writeBits(16, low);
    return;
  }
  var i;
  for (i = n - 1; i >= 0; i--) {
    this.writeBit((value >>> i) & 1);
  }
};

return BitStream;
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


BWT = (function(){
/** Burrows-Wheeler transform, computed with the Induced Sorting Suffix Array
 *  construction mechanism (sais).  Code is a port of:
 *    https://sites.google.com/site/yuta256/sais
 *  which is:
 *    Copyright (c) 2008-2010 Yuta Mori All Rights Reserved.
 *  and licensed under an MIT/X11 license.  I generally looked at both
 *  the C and the Java implementations to guide my work.
 *
 * This JavaScript port is:
 *    Copyright (c) 2013 C. Scott Ananian
 * and licensed under GPLv2; see the README at the top level of this package.
 */

var ASSERT = console.assert.bind(console);

// we're dispensing with the "arbitrary alphabet" stuff of the source
// and just using Uint8Arrays.

/** Find the start or end of each bucket. */
var getCounts = function(T, C, n, k) {
  var i;
  for (i = 0; i < k; i++) { C[i] = 0; }
  for (i = 0; i < n; i++) { C[T[i]]++; }
};
var getBuckets = function(C, B, k, end) {
  var i, sum = 0;
  if (end) {
    for (i = 0; i < k; i++) {
      sum += C[i];
      B[i] = sum;
    }
  } else {
    for (i = 0; i < k; i++) {
      sum += C[i];
      B[i] = sum - C[i];
    }
  }
};

/** Sort all type LMS suffixes */
var LMSsort = function(T, SA, C, B, n, k) {
  var b, i, j;
  var c0, c1;
  /* compute SAl */
  if (C === B) { getCounts(T, C, n, k); }
  getBuckets(C, B, k, false); /* find starts of buckets */
  j = n - 1;
  b = B[c1 = T[j]];
  j--;
  SA[b++] = (T[j] < c1) ? ~j : j;
  for (i = 0; i < n; i++) {
    if ((j = SA[i]) > 0) {
      ASSERT(T[j] >= T[j + 1]);
      if ((c0 = T[j]) !== c1) {
        B[c1] = b;
        b = B[c1 = c0];
      }
      ASSERT(i < b);
      j--;
      SA[b++] = (T[j] < c1) ? ~j : j;
      SA[i] = 0;
    } else if (j < 0) {
      SA[i] = ~j;
    }
  }
  /* compute SAs */
  if (C === B) { getCounts(T, C, n, k); }
  getBuckets(C, B, k, 1); /* find ends of buckets */
  for (i = n - 1, b = B[c1 = 0]; i >= 0; i--) {
    if ((j = SA[i]) > 0) {
      ASSERT(T[j] <= T[j + 1]);
      if ((c0 = T[j]) !== c1) {
        B[c1] = b;
        b = B[c1 = c0];
      }
      ASSERT(b <= i);
      j--;
      SA[--b] = (T[j] > c1) ? ~(j + 1) : j;
      SA[i] = 0;
    }
  }
};

var LMSpostproc = function(T, SA, n, m) {
  var i, j, p, q, plen, qlen, name;
  var c0, c1;
  var diff;

  /* compact all the sorted substrings into the first m items of SA
   * 2*m must not be larger than n (provable) */
  ASSERT(n > 0);
  for (i = 0;
    (p = SA[i]) < 0; i++) {
    SA[i] = ~p;
    ASSERT((i + 1) < n);
  }
  if (i < m) {
    for (j = i, i++;; i++) {
      ASSERT(i < n);
      if ((p = SA[i]) < 0) {
        SA[j++] = ~p;
        SA[i] = 0;
        if (j === m) { break; }
      }
    }
  }

  /* store the length of all substrings */
  c0 = T[i = j = n - 1];
  do { c1 = c0; } while (((--i) >= 0) && ((c0 = T[i]) >= c1));
  for (; i >= 0;) {
    do { c1 = c0; } while (((--i) >= 0) && ((c0 = T[i]) <= c1));
    if (i >= 0) {
      SA[m + ((i + 1) >>> 1)] = j - i;
      j = i + 1;
      do { c1 = c0; } while (((--i) >= 0) && ((c0 = T[i]) >= c1));
    }
  }

  /* find the lexicographic names of all substrings */
  for (i = 0, name = 0, q = n, qlen = 0; i < m; i++) {
    p = SA[i];
    plen = SA[m + (p >>> 1)];
    diff = true;
    if ((plen === qlen) && ((q + plen) < n)) {
      for (j = 0;
        (j < plen) && (T[p + j] === T[q + j]);) { j++; }
      if (j === plen) { diff = false; }
    }
    if (diff) {
      name++;
      q = p;
      qlen = plen;
    }
    SA[m + (p >>> 1)] = name;
  }

  return name;
};

/* compute SA and BWT */
var induceSA = function(T, SA, C, B, n, k) {
  var b, i, j;
  var c0, c1;
  /* compute SAl */
  if (C === B) { getCounts(T, C, n, k); }
  getBuckets(C, B, k, false); /* find starts of buckets */
  j = n - 1;
  b = B[c1 = T[j]];
  SA[b++] = ((j > 0) && (T[j - 1] < c1)) ? ~j : j;
  for (i = 0; i < n; i++) {
    j = SA[i];
    SA[i] = ~j;
    if (j > 0) {
      j--;
      ASSERT(T[j] >= T[j + 1]);
      if ((c0 = T[j]) !== c1) {
        B[c1] = b;
        b = B[c1 = c0];
      }
      ASSERT(i < b);
      SA[b++] = ((j > 0) && (T[j - 1] < c1)) ? ~j : j;
    }
  }
  /* compute SAs */
  if (C === B) { getCounts(T, C, n, k); }
  getBuckets(C, B, k, true); /* find ends of buckets */
  for (i = n - 1, b = B[c1 = 0]; i >= 0; i--) {
    if ((j = SA[i]) > 0) {
      j--;
      ASSERT(T[j] <= T[j + 1]);
      if ((c0 = T[j]) !== c1) {
        B[c1] = b;
        b = B[c1 = c0];
      }
      ASSERT(b <= i);
      SA[--b] = ((j === 0) || (T[j - 1] > c1)) ? ~j : j;
    } else {
      SA[i] = ~j;
    }
  }
};

var computeBWT = function(T, SA, C, B, n, k) {
  var b, i, j, pidx = -1;
  var c0, c1;
  /* compute SAl */
  if (C === B) { getCounts(T, C, n, k); }
  getBuckets(C, B, k, false); /* find starts of buckets */
  j = n - 1;
  b = B[c1 = T[j]];
  SA[b++] = ((j > 0) && (T[j - 1] < c1)) ? ~j : j;
  for (i = 0; i < n; i++) {
    if ((j = SA[i]) > 0) {
      j--;
      ASSERT(T[j] >= T[j + 1]);
      SA[i] = ~(c0 = T[j]);
      if (c0 !== c1) {
        B[c1] = b;
        b = B[c1 = c0];
      }
      ASSERT(i < b);
      SA[b++] = ((j > 0) && (T[j - 1] < c1)) ? ~j : j;
    } else if (j !== 0) {
      SA[i] = ~j;
    }
  }
  /* compute SAs */
  if (C === B) { getCounts(T, C, n, k); }
  getBuckets(C, B, k, true); /* find ends of buckets */
  for (i = n - 1, b = B[c1 = 0]; i >= 0; i--) {
    if ((j = SA[i]) > 0) {
      j--;
      ASSERT(T[j] <= T[j + 1]);
      SA[i] = c0 = T[j];
      if (c0 !== c1) {
        B[c1] = b;
        b = B[c1 = c0];
      }
      ASSERT(b <= i);
      SA[--b] = ((j > 0) && (T[j - 1] > c1)) ? (~T[j - 1]) : j;
    } else if (j !== 0) {
      SA[i] = ~j;
    } else {
      pidx = i;
    }
  }
  return pidx;
};

/* find the suffix array SA of T[0..n-1] in {0..k-1}^n
   use a working space (excluding T and SA) of at most 2n+O(1) for a
   constant alphabet */
var SA_IS = function(T, SA, fs, n, k, isbwt) {
  var C, B, RA;
  var i, j, b, c, m, p, q, name, pidx = 0
    , newfs;
  var c0, c1;
  var flags = 0;

  // allocate temporary storage [CSA]
  if (k <= 256) {
    C = Util.makeS32Buffer(k);
    if (k <= fs) {
      B = SA.subarray(n + fs - k);
      flags = 1;
    } else {
      B = Util.makeS32Buffer(k);
      flags = 3;
    }
  } else if (k <= fs) {
    C = SA.subarray(n + fs - k);
    if (k <= (fs - k)) {
      B = SA.subarray(n + fs - k * 2);
      flags = 0;
    } else if (k <= 1024) {
      B = Util.makeS32Buffer(k);
      flags = 2;
    } else {
      B = C;
      flags = 8;
    }
  } else {
    C = B = Util.makeS32Buffer(k);
    flags = 4 | 8;
  }

  /* stage 1: reduce the problem by at least 1/2
     sort all the LMS-substrings */
  getCounts(T, C, n, k);
  getBuckets(C, B, k, true); /* find ends of buckets */
  for (i = 0; i < n; i++) { SA[i] = 0; }
  b = -1;
  i = n - 1;
  j = n;
  m = 0;
  c0 = T[n - 1];
  do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) >= c1));
  for (; i >= 0;) {
    do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) <= c1));
    if (i >= 0) {
      if (b >= 0) { SA[b] = j; }
      b = --B[c1];
      j = i;
      ++m;
      do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) >= c1));
    }
  }

  if (m > 1) {
    LMSsort(T, SA, C, B, n, k);
    name = LMSpostproc(T, SA, n, m);
  } else if (m === 1) {
    SA[b] = j + 1;
    name = 1;
  } else {
    name = 0;
  }

  /* stage 2: solve the reduced problem
     recurse if names are not yet unique */
  if (name < m) {
    if ((flags & 4) !== 0) {
      C = null;
      B = null;
    }
    if ((flags & 2) !== 0) { B = null; }
    newfs = (n + fs) - (m * 2);
    if ((flags & (1 | 4 | 8)) === 0) {
      if ((k + name) <= newfs) { newfs -= k; } else { flags |= 8; }
    }
    ASSERT((n >>> 1) <= (newfs + m));
    for (i = m + (n >>> 1) - 1, j = m * 2 + newfs - 1; m <= i; i--) {
      if (SA[i] !== 0) { SA[j--] = SA[i] - 1; }
    }
    RA = SA.subarray(m + newfs);
    SA_IS(RA, SA, newfs, m, name, false);
    RA = null;

    i = n - 1;
    j = m * 2 - 1;
    c0 = T[n - 1];
    do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) >= c1));
    for (; i >= 0;) {
      do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) <= c1));
      if (i >= 0) {
        SA[j--] = i + 1;
        do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) >= c1));
      }
    }

    for (i = 0; i < m; i++) { SA[i] = SA[m + SA[i]]; }
    if ((flags & 4) !== 0) { C = B = Util.makeS32Buffer(k); }
    if ((flags & 2) !== 0) { B = Util.makeS32Buffer(k); }
  }

  /* stage 3: induce the result for the original problem */
  if ((flags & 8) !== 0) { getCounts(T, C, n, k); }
  /* put all left-most S characters into their buckets */
  if (m > 1) {
    getBuckets(C, B, k, true); /* find ends of buckets */
    i = m - 1;
    j = n;
    p = SA[m - 1];
    c1 = T[p];
    do {
      q = B[c0 = c1];
      while (q < j) { SA[--j] = 0; }
      do {
        SA[--j] = p;
        if (--i < 0) { break; }
        p = SA[i];
      } while ((c1 = T[p]) === c0);
    } while (i >= 0);
    while (j > 0) { SA[--j] = 0; }
  }
  if (!isbwt) { induceSA(T, SA, C, B, n, k); } else { pidx = computeBWT(T, SA, C, B, n, k); }
  C = null;
  B = null;
  return pidx;
};

var BWT = Object.create(null);
/** SA should be a Int32Array (signed!); T can be any typed array.
 *  alphabetSize is optional if T is an Uint8Array or Uint16Array. */
BWT.suffixsort = function(T, SA, n, alphabetSize) {
  ASSERT(T && SA && T.length >= n && SA.length >= n);
  if (n <= 1) {
    if (n === 1) { SA[0] = 0; }
    return 0;
  }
  if (!alphabetSize) {
    if (T.BYTES_PER_ELEMENT === 1) { alphabetSize = 256; } else if (T.BYTES_PER_ELEMENT === 2) { alphabetSize = 65536; } else throw new Error('Need to specify alphabetSize');
  }
  ASSERT(alphabetSize > 0);
  if (T.BYTES_PER_ELEMENT) {
    ASSERT(alphabetSize <= (1 << (T.BYTES_PER_ELEMENT * 8)));
  }
  return SA_IS(T, SA, 0, n, alphabetSize, false);
};
/** Burrows-Wheeler Transform.
    A should be Int32Array (signed!); T can be any typed array.
    U is the same type as T (it is used for output).
    alphabetSize is optional if T is an Uint8Array or Uint16Array.
    ASSUMES STRING IS TERMINATED WITH AN EOF CHARACTER.
*/
BWT.bwtransform = function(T, U, A, n, alphabetSize) {
  var i, pidx;
  ASSERT(T && U && A);
  ASSERT(T.length >= n && U.length >= n && A.length >= n);
  if (n <= 1) {
    if (n === 1) { U[0] = T[0]; }
    return n;
  }
  if (!alphabetSize) {
    if (T.BYTES_PER_ELEMENT === 1) { alphabetSize = 256; } else if (T.BYTES_PER_ELEMENT === 2) { alphabetSize = 65536; } else throw new Error('Need to specify alphabetSize');
  }
  ASSERT(alphabetSize > 0);
  if (T.BYTES_PER_ELEMENT) {
    ASSERT(alphabetSize <= (1 << (T.BYTES_PER_ELEMENT * 8)));
  }
  pidx = SA_IS(T, A, 0, n, alphabetSize, true);
  U[0] = T[n - 1];
  for (i = 0; i < pidx; i++) { U[i + 1] = A[i]; }
  for (i += 1; i < n; i++) { U[i] = A[i]; }
  return pidx + 1;
};
/** Reverses transform above. (ASSUMED STRING IS TERMINATED WITH EOF.) */
BWT.unbwtransform = function(T, U, LF, n, pidx) {
  var C = Util.makeU32Buffer(256);
  var i, t;
  for (i = 0; i < 256; i++) { C[i] = 0; }
  for (i = 0; i < n; i++) { LF[i] = C[T[i]]++; }
  for (i = 0, t = 0; i < 256; i++) {
    t += C[i];
    C[i] = t - C[i];
  }
  for (i = n - 1, t = 0; i >= 0; i--) {
    t = LF[t] + C[U[i] = T[t]];
    t += (t < pidx) ? 1 : 0;
  }
  C = null;
};

/** Burrows-Wheeler Transform.
    A should be Int32Array (signed!); T can be any typed array.
    U is the same type as T (it is used for output).
    alphabetSize is optional if T is an Uint8Array or Uint16Array.
    ASSUMES STRING IS CYCLIC.
    (XXX: this is twice as inefficient as I'd like! [CSA])
*/
BWT.bwtransform2 = function(T, U, n, alphabetSize) {
  var i, j, pidx = 0;
  ASSERT(T && U);
  ASSERT(T.length >= n && U.length >= n);
  if (n <= 1) {
    if (n === 1) { U[0] = T[0]; }
    return 0;
  }
  if (!alphabetSize) {
    if (T.BYTES_PER_ELEMENT === 1) { alphabetSize = 256; } else if (T.BYTES_PER_ELEMENT === 2) { alphabetSize = 65536; } else throw new Error('Need to specify alphabetSize');
  }
  ASSERT(alphabetSize > 0);
  if (T.BYTES_PER_ELEMENT) {
    ASSERT(alphabetSize <= (1 << (T.BYTES_PER_ELEMENT * 8)));
  }
  // double length of T
  var TT;
  if (T.length >= n * 2) {
    TT = T; // do it in place if possible
  } else if (alphabetSize <= 256) {
    TT = Util.makeU8Buffer(n * 2);
  } else if (alphabetSize <= 65536) {
    TT = Util.makeU16Buffer(n * 2);
  } else {
    TT = Util.makeU32Buffer(n * 2);
  }
  if (TT !== T) {
    for (i = 0; i < n; i++) { TT[i] = T[i]; }
  }
  for (i = 0; i < n; i++) { TT[n + i] = TT[i]; }
  // sort doubled string
  var A = Util.makeS32Buffer(n * 2);
  SA_IS(TT, A, 0, n * 2, alphabetSize, false);
  for (i = 0, j = 0; i < 2 * n; i++) {
    var s = A[i];
    if (s < n) {
      if (s === 0) { pidx = j; }
      if (--s < 0) { s = n - 1; }
      U[j++] = T[s];
    }
  }
  ASSERT(j === n);
  return pidx;
};

return BWT;
}());


LogDistanceModel = (function(){
/** Simple (log n)(n) distance model. */

// lengthBitsModelFactory will be called with arguments 2, 4, 8, 16, etc
// and must return an appropriate model or coder.
var LogDistanceModel = function(size, extraStates
  , lgDistanceModelFactory
  , lengthBitsModelFactory) {
  var i;
  var bits = Util.fls(size - 1);
  this.extraStates = +extraStates || 0;
  this.lgDistanceModel = lgDistanceModelFactory(1 + bits + extraStates);
  // this.distanceModel[n] used for distances which are n-bits long,
  // but only n-1 bits are encoded: the top bit is known to be one.
  this.distanceModel = [];
  for (i = 2; i <= bits; i++) {
    var numBits = i - 1;
    this.distanceModel[i] = lengthBitsModelFactory(1 << numBits);
  }
};
/* you can give this model arguments between 0 and (size-1), or else
   a negative argument which is one of the 'extra states'. */
LogDistanceModel.prototype.encode = function(distance) {
  if (distance < 2) { // small distance or an 'extra state'
    this.lgDistanceModel.encode(distance + this.extraStates);
    return;
  }
  var lgDistance = Util.fls(distance);
  console.assert(distance & (1 << (lgDistance - 1))); // top bit is set
  console.assert(lgDistance >= 2);
  this.lgDistanceModel.encode(lgDistance + this.extraStates);
  // now encode the rest of the bits.
  var rest = distance & ((1 << (lgDistance - 1)) - 1);
  this.distanceModel[lgDistance].encode(rest);
};
LogDistanceModel.prototype.decode = function() {
  var lgDistance = this.lgDistanceModel.decode() - this.extraStates;
  if (lgDistance < 2) {
    return lgDistance; // this is a small distance or an 'extra state'
  }
  var rest = this.distanceModel[lgDistance].decode();
  return (1 << (lgDistance - 1)) + rest;
};

return LogDistanceModel;

}());


NoModel = (function(){
/** Simple "lack of model" -- just encode the bits directly.
 *  Useful especially with sparse spaces or Huffman coders where there's
 *  no obvious prediction to be made that will pay for itself.
 */

var NoModel = function(bitstream, size) {
  this.bitstream = bitstream;
  this.bits = Util.fls(size - 1);
};
NoModel.factory = function(bitstream) {
  return function(size) { return new NoModel(bitstream, size); };
};
NoModel.prototype.encode = function(symbol) {
  var i;
  for (i = this.bits - 1; i >= 0; i--) {
    var b = (symbol >>> i) & 1;
    this.bitstream.writeBit(b);
  }
};
NoModel.prototype.decode = function() {
  var i, r = 0;
  for (i = this.bits - 1; i >= 0; i--) {
    r <<= 1;
    if (this.bitstream.readBit()) r++;
  }
  return r;
};

/** Brain-dead self-test. */
NoModel.MAGIC = 'nomo';
NoModel.compressFile = Util.compressFileHelper(NoModel.MAGIC, function(inStream, outStream, fileSize, props) {
  var bitstream = new BitStream(outStream);
  var model = new NoModel(bitstream, (fileSize < 0) ? 257 : 256);
  Util.compressWithModel(inStream, fileSize, model);
  bitstream.flush();
});
NoModel.decompressFile = Util.decompressFileHelper(NoModel.MAGIC, function(inStream, outStream, fileSize) {
  var bitstream = new BitStream(inStream);
  var model = new NoModel(bitstream, (fileSize < 0) ? 257 : 256);
  Util.decompressWithModel(outStream, fileSize, model);
});

return NoModel;


}());


DefSumModel = (function(){

/** Deferred-sum model, suitable for small ( ~ 256 ) ranges. */
// See http://cbloom.com/src/defsum.zip
//     http://cbloom.com/papers/context.pdf

var LOG_PROB_TOTAL = 8;
var PROB_TOTAL = 1 << LOG_PROB_TOTAL;
var MAX_ESCAPE_COUNT = 40;

var DefSumModel = function(coder, size, isDecoder) {
  var i;
  console.assert(size < 300); // not meant for sparse
  var ESCAPE = this.numSyms = size;
  this.coder = coder;
  this.prob = Util.makeU16Buffer(size + 2); /* size + ESC + 1 */
  this.escape = Util.makeU16Buffer(size + 1); /* size + 1*/
  this.update = Util.makeU16Buffer(size + 1); /* size + ESC */
  this.prob[ESCAPE + 1] = PROB_TOTAL;
  for (i = 0; i <= this.numSyms; i++) {
    this.escape[i] = i;
  }
  this.updateCount = 0;
  this.updateThresh = PROB_TOTAL - Math.floor(PROB_TOTAL / 2);
  if (!isDecoder) {
    return;
  }
  // extra tables for fast decoding
  this.probToSym = Util.makeU16Buffer(PROB_TOTAL);
  this.escProbToSym = Util.makeU16Buffer(this.numSyms);
  for (i = 0; i < PROB_TOTAL; i++) {
    this.probToSym[i] = ESCAPE;
  }
  for (i = 0; i < this.numSyms; i++) {
    this.escProbToSym[i] = i;
  }
};
DefSumModel.factory = function(coder, isDecoder) {
  return function(size) {
    return new DefSumModel(coder, size, isDecoder);
  };
};
DefSumModel.prototype._update = function(symbol, isDecoder) {
  if (symbol === this.numSyms) {
    // some special cases for the escape character
    if (this.update[symbol] >= MAX_ESCAPE_COUNT) {
      return;
    } // hard limit
    // don't let an escape character trigger an update, because then the
    // escaped character might find itself unescaped after the tables have
    // been updated!
    if (this.updateCount >= (this.updateThresh - 1)) {
      return;
    }
  }
  this.update[symbol]++;
  this.updateCount++;
  // is it time to transfer the updated probabilities?
  if (this.updateCount < this.updateThresh) {
    return; //defer update
  }
  var cumProb, cumEscProb, odd, i, j, k;
  this.escape[0] = this.prob[0] = cumProb = cumEscProb = odd = 0;
  for (i = 0; i < this.numSyms + 1; i++) {
    var newProb = ((this.prob[i + 1] - this.prob[i]) >>> 1) + this.update[i];
    if (newProb) {
      // live 'un
      this.prob[i] = cumProb;
      cumProb += newProb;
      if (newProb & 1) {
        odd++;
      }
      this.escape[i] = cumEscProb;
    } else {
      // this symbol will escape
      this.prob[i] = cumProb;
      this.escape[i] = cumEscProb;
      cumEscProb++;
    }
  }
  this.prob[i] = cumProb;
  console.assert(cumProb === PROB_TOTAL);
  /* how many updates will be required after current probs are halved? */
  this.updateThresh = PROB_TOTAL - Math.floor((cumProb - odd) / 2);
  /* reset the update table */
  for (i = 0; i < (this.numSyms + 1); i++) {
    this.update[i] = 0;
  }
  this.update[this.numSyms] = 1; // ensure that escape never goes away
  this.updateCount = 1;
  /* compute decode table, if this is a decoder */
  if (!isDecoder) {
    return;
  }
  for (i = 0, j = 0, k = 0; i < (this.numSyms + 1); i++) {
    var probLimit = this.prob[i + 1];
    for (; j < probLimit; j++) {
      this.probToSym[j] = i;
    }
    var escProbLimit = this.escape[i + 1];
    for (; k < escProbLimit; k++) {
      this.escProbToSym[k] = i;
    }
  }
};
DefSumModel.prototype.encode = function(symbol) {
  var lt_f = this.prob[symbol];
  var sy_f = this.prob[symbol + 1] - lt_f;
  console.assert(this.prob[this.numSyms + 1] === PROB_TOTAL);
  if (sy_f) {
    this.coder.encodeShift(sy_f, lt_f, LOG_PROB_TOTAL);
    return this._update(symbol);
  }
  // escape!
  console.assert(symbol !== this.numSyms); // catch infinite recursion
  this.encode(this.numSyms); // guaranteed non-zero probability
  // code symbol as literal, taking advantage of reduced escape range.
  lt_f = this.escape[symbol];
  sy_f = this.escape[symbol + 1] - lt_f;
  var tot_f = this.escape[this.numSyms];
  this.coder.encodeFreq(sy_f, lt_f, tot_f);
  return this._update(symbol);
};
DefSumModel.prototype.decode = function() {
  var prob = this.coder.decodeCulShift(LOG_PROB_TOTAL);
  var symbol = this.probToSym[prob];
  var lt_f = this.prob[symbol];
  var sy_f = this.prob[symbol + 1] - lt_f;
  this.coder.decodeUpdate(sy_f, lt_f, PROB_TOTAL);
  this._update(symbol, true);
  if (symbol !== this.numSyms) {
    return symbol;
  }
  // escape!
  var tot_f = this.escape[this.numSyms];
  prob = this.coder.decodeCulFreq(tot_f);
  symbol = this.escProbToSym[prob];
  lt_f = this.escape[symbol];
  sy_f = this.escape[symbol + 1] - lt_f;
  this.coder.decodeUpdate(sy_f, lt_f, tot_f);
  this._update(symbol, true);
  return symbol;
};

DefSumModel.MAGIC = 'dfsm';
/** Simple order-0 compressor, as self-test. */
DefSumModel.compressFile = Util.compressFileHelper(DefSumModel.MAGIC, function(inStream, outStream, fileSize, props, finalByte) {
  var range = new RangeCoder(outStream);
  range.encodeStart(finalByte, 1);
  var model = new DefSumModel(range, (fileSize < 0) ? 257 : 256);
  Util.compressWithModel(inStream, fileSize, model);
  range.encodeFinish();
}, true);
/** Simple order-0 decompresser, as self-test. */
DefSumModel.decompressFile = Util.decompressFileHelper(DefSumModel.MAGIC, function(inStream, outStream, fileSize) {
  var range = new RangeCoder(inStream);
  range.decodeStart(true /*already read the final byte*/ );
  var model = new DefSumModel(range, (fileSize < 0) ? 257 : 256, true);
  Util.decompressWithModel(outStream, fileSize, model);
  range.decodeFinish();
});

return DefSumModel;
}());


FenwickModel = (function(){
/** Range coding model based on Fenwick trees for O(ln N) query/update. */

/** We store two probabilities in a U32, so max prob is going to be 0xFFFF */
var DEFAULT_MAX_PROB = 0xFF00;
var DEFAULT_INCREMENT = 0x0100;

var ESC_MASK = 0x0000FFFF
  , ESC_SHIFT = 0;
var SYM_MASK = 0xFFFF0000
  , SYM_SHIFT = 16;
var SCALE_MASK = 0xFFFEFFFE;

var FenwickModel = function(coder, size, max_prob, increment) {
  this.coder = coder;
  this.numSyms = size + 1; // save space for an escape symbol
  this.tree = Util.makeU32Buffer(this.numSyms * 2);
  this.increment = (+increment) || DEFAULT_INCREMENT;
  this.max_prob = (+max_prob) || DEFAULT_MAX_PROB;
  // sanity-check to prevent overflow.
  console.assert((this.max_prob + (this.increment - 1)) <= 0xFFFF);
  console.assert(size <= 0xFFFF);
  // record escape probability as 1.
  var i;
  for (i = 0; i < size; i++) {
    this.tree[this.numSyms + i] = // escape prob=1, sym prob = 0
      (1 << ESC_SHIFT) | (0 << SYM_SHIFT);
  }
  this.tree[this.numSyms + i] = // escape prob = 0, sym prob = 1
    (0 << ESC_SHIFT) | (this.increment << SYM_SHIFT);
  this._sumTree();
  // probability sums are in this.tree[1].  this.tree[0] is unused.
};
FenwickModel.factory = function(coder, max_prob, increment) {
  return function(size) {
    return new FenwickModel(coder, size, max_prob, increment);
  };
};
FenwickModel.prototype.clone = function() {
  var newModel = new FenwickModel(this.coder, this.size
    , this.max_prob, this.increment);
  var i;
  for (i = 1; i < this.tree.length; i++) {
    newModel.tree[i] = this.tree[i];
  }
  return newModel;
};
FenwickModel.prototype.encode = function(symbol) {
  var i = this.numSyms + symbol;
  var sy_f = this.tree[i];
  var mask = SYM_MASK
    , shift = SYM_SHIFT;
  var update = (this.increment << SYM_SHIFT);

  if ((sy_f & SYM_MASK) === 0) { // escape!
    this.encode(this.numSyms - 1);
    mask = ESC_MASK;
    update -= (1 << ESC_SHIFT); // not going to escape no mo'
    shift = ESC_SHIFT;
  } else if (symbol === (this.numSyms - 1) &&
    ((this.tree[1] & ESC_MASK) >>> ESC_SHIFT) === 1) {
    // this is the last escape, zero it out
    update = -this.tree[i];
  }
  // sum up the proper lt_f
  var lt_f = 0;
  while (i > 1) {
    var isRight = (i & 1);
    var parent = (i >>> 1);
    // if we're the right child, we need to
    // add the prob from the left child
    if (isRight) {
      lt_f += this.tree[2 * parent];
    }
    // update sums
    this.tree[i] += update; // increase sym / decrease esc
    i = parent;
  }
  var tot_f = this.tree[1];
  this.tree[1] += update; // update prob in root
  sy_f = (sy_f & mask) >>> shift;
  lt_f = (lt_f & mask) >>> shift;
  tot_f = (tot_f & mask) >>> shift;
  this.coder.encodeFreq(sy_f, lt_f, tot_f);
  // rescale?
  if (((this.tree[1] & SYM_MASK) >>> SYM_SHIFT) >= this.max_prob) {
    this._rescale();
  }
};
FenwickModel.prototype._decode = function(isEscape) {
  var mask = SYM_MASK
    , shift = SYM_SHIFT;
  var update = (this.increment << SYM_SHIFT);
  if (isEscape) {
    mask = ESC_MASK;
    update -= (1 << ESC_SHIFT);
    shift = ESC_SHIFT;
  }
  var tot_f = (this.tree[1] & mask) >>> shift;
  var prob = this.coder.decodeCulFreq(tot_f);
  // travel down the tree looking for this
  var i = 1
    , lt_f = 0;
  while (i < this.numSyms) {
    this.tree[i] += update;
    // look at probability in left child.
    var leftProb = (this.tree[2 * i] & mask) >>> shift;
    i *= 2;
    if ((prob - lt_f) >= leftProb) {
      lt_f += leftProb;
      i++; // take the right child.
    }
  }
  var symbol = i - this.numSyms;
  var sy_f = (this.tree[i] & mask) >>> shift;
  this.tree[i] += update;
  this.coder.decodeUpdate(sy_f, lt_f, tot_f);
  // was this the last escape?
  if (symbol === (this.numSyms - 1) &&
    ((this.tree[1] & ESC_MASK) >>> ESC_SHIFT) === 1) {
    update = -this.tree[i]; // zero it out
    while (i >= 1) {
      this.tree[i] += update;
      i = (i >>> 1); // parent
    }
  }
  // rescale?
  if (((this.tree[1] & SYM_MASK) >>> SYM_SHIFT) >= this.max_prob) {
    this._rescale();
  }
  return symbol;
};
FenwickModel.prototype.decode = function() {
  var symbol = this._decode(false); // not escape
  if (symbol === (this.numSyms - 1)) {
    // this was an escape!
    symbol = this._decode(true); // an escape!
  }
  return symbol;
};
FenwickModel.prototype._rescale = function() {
  var i, prob, noEscape = true;
  // scale symbols (possible causing them to escape)
  for (i = 0; i < this.numSyms - 1; i++) {
    prob = this.tree[this.numSyms + i];
    if ((prob & ESC_MASK) !== 0) {
      // this symbol escapes
      noEscape = false;
      continue;
    }
    prob = (prob & SCALE_MASK) >>> 1;
    if (prob === 0) {
      // this symbol newly escapes
      prob = (1 << ESC_SHIFT);
      noEscape = false;
    }
    this.tree[this.numSyms + i] = prob;
  }
  // scale the escape symbol
  prob = this.tree[this.numSyms + i];
  prob = (prob & SCALE_MASK) >>> 1;
  // prob should be zero if there are no escaping symbols, otherwise
  // it must be at least 1.
  if (noEscape) {
    prob = 0;
  } else if (prob === 0) {
    prob = (1 << SYM_SHIFT);
  }
  this.tree[this.numSyms + i] = prob;
  // sum it all up afresh
  this._sumTree();
};
FenwickModel.prototype._sumTree = function() {
  var i;
  // sum it all. (we know we won't overflow)
  for (i = this.numSyms - 1; i > 0; i--) {
    this.tree[i] = this.tree[2 * i] + this.tree[2 * i + 1];
  }
};

FenwickModel.MAGIC = 'fenw';
/** Simple order-0 compressor, as self-test. */
FenwickModel.compressFile = Util.compressFileHelper(FenwickModel.MAGIC, function(inStream, outStream, fileSize, props, finalByte) {
  var range = new RangeCoder(outStream);
  range.encodeStart(finalByte, 1);
  var model = new FenwickModel(range, (fileSize < 0) ? 257 : 256);
  Util.compressWithModel(inStream, fileSize, model);
  range.encodeFinish();
}, true);

/** Simple order-0 decompresser, as self-test. */
FenwickModel.decompressFile = Util.decompressFileHelper(FenwickModel.MAGIC, function(inStream, outStream, fileSize) {
  var range = new RangeCoder(inStream);
  range.decodeStart(true /*already read the final byte*/ );
  var model = new FenwickModel(range, (fileSize < 0) ? 257 : 256);
  Util.decompressWithModel(outStream, fileSize, model);
  range.decodeFinish();
});

return FenwickModel;

}());


BWTC = (function(){
/* A simple bzip-like BWT compressor with a range encoder; written as a
 * self-test of the BWT package. */

var EOF = Stream.EOF;

var F_PROB_MAX = 0xFF00;
var F_PROB_INCR = 0x0100;

BWTC = Object.create(null);
BWTC.MAGIC = "bwtc";
BWTC.compressFile = Util.compressFileHelper(BWTC.MAGIC, function(input, output, size, props, finalByte) {
  var encoder = new RangeCoder(output);
  encoder.encodeStart(finalByte, 1);

  var blockSize = 9;
  if (typeof(props) === 'number' && props >= 1 && props <= 9) {
    blockSize = props;
  }
  encoder.encodeByte(blockSize);
  var fast = (blockSize <= 5);
  blockSize *= 100000;

  var block = Util.makeU8Buffer(blockSize);
  var readBlock = function() {
    var pos;
    for (pos = 0; pos < blockSize;) {
      var ch = input.readByte();
      if (ch < 0) { break; }
      block[pos++] = ch;
    }
    return pos;
  };
  var U = Util.makeU8Buffer(blockSize);
  var A = Util.makeS32Buffer(blockSize);
  var M = Util.makeU8Buffer(256); // move to front array
  var bitModelFactory = NoModel.factory(encoder);
  var lenModel = new LogDistanceModel(blockSize, 0
    , bitModelFactory
    , bitModelFactory);
  var length, b, c, pidx, i, j;
  do {
    length = readBlock();
    if (length === 0) { break; }
    // indicate that there's another block comin'
    // and encode the length of the block if necessary
    if (length === block.length) {
      encoder.encodeFreq(1, 0, 3); // "full size block"
      b = block;
    } else {
      encoder.encodeFreq(1, 1, 3); // "short block"
      lenModel.encode(length);
      b = block.subarray(0, length);
    }
    pidx = BWT.bwtransform(b, U, A, length, 256);
    lenModel.encode(pidx); // starting index
    // encode the alphabet subset used
    var useTree = Util.makeU16Buffer(512);
    for (i = 0; i < length; i++) {
      c = U[i];
      useTree[256 + c] = 1;
    }
    for (i = 255; i > 0; i--) { // sum all the way up the tree
      useTree[i] = useTree[2 * i] + useTree[2 * i + 1];
    }
    useTree[0] = 1; // sentinel
    for (i = 1; i < 512; i++) {
      var parent = i >>> 1;
      var full = 1 << (9 - Util.fls(i));
      if (useTree[parent] === 0 || useTree[parent] === (full * 2)) {
        /* already known full/empty */
      } else if (i >= 256) {
        encoder.encodeBit(useTree[i]); // leaf node
      } else {
        var v = useTree[i];
        v = (v === 0) ? 0 : (v === full) ? 2 : 1;
        encoder.encodeFreq(1, v, 3);
      }
    }
    // remap symbols to this subset
    var alphabetSize = 0;
    for (i = 0; i < 256; i++) {
      if (useTree[256 + i]) { // symbol in use
        M[alphabetSize++] = i;
      }
    }
    useTree = null;
    // MTF encoding of U
    for (i = 0; i < length; i++) {
      c = U[i];
      for (j = 0; j < alphabetSize; j++) {
        if (M[j] === c) {
          break;
        }
      }
      console.assert(j < alphabetSize);
      U[i] = j;
      // move to front
      for (; j > 0; j--) {
        M[j] = M[j - 1];
      }
      M[0] = c;
    }
    // RLE/range encoding
    var model = new FenwickModel(encoder, alphabetSize + 1
      , F_PROB_MAX, F_PROB_INCR);
    if (fast) { model = new DefSumModel(encoder, alphabetSize + 1); }
    var runLength = 0;
    var emitLastRun = function() {
      // binary encode runs of zeros
      while (runLength !== 0) {
        if (runLength & 1) {
          model.encode(0); // RUNA
          runLength -= 1;
        } else {
          model.encode(1); // RUNB
          runLength -= 2;
        }
        runLength >>>= 1;
      }
    };
    for (i = 0; i < length; i++) {
      c = U[i];
      if (c === 0) {
        runLength++;
      } else {
        emitLastRun();
        model.encode(c + 1);
        // reset for next
        runLength = 0;
      }
    }
    emitLastRun();
    // done with this block!
  } while (length === block.length);

  encoder.encodeFreq(1, 2, 3); // "no more blocks"
  encoder.encodeFinish();
}, true);

BWTC.decompressFile = Util.decompressFileHelper(BWTC.MAGIC, function(input, output, size) {
  var decoder = new RangeCoder(input);
  decoder.decodeStart(true /* already read the extra byte */ );
  var blockSize = decoder.decodeByte();
  console.assert(blockSize >= 1 && blockSize <= 9);
  var fast = (blockSize <= 5);
  blockSize *= 100000;

  var block = Util.makeU8Buffer(blockSize);
  var U = Util.makeU8Buffer(blockSize);
  var A = Util.makeS32Buffer(blockSize);
  var M = Util.makeU8Buffer(256); // move to front array
  var bitModelFactory = NoModel.factory(decoder);
  var lenModel = new LogDistanceModel(blockSize, 0
    , bitModelFactory
    , bitModelFactory);
  var b, length, i, j, c;
  while (true) {
    var blockIndicator = decoder.decodeCulFreq(3);
    decoder.decodeUpdate(1, blockIndicator, 3);
    if (blockIndicator === 0) { // full-length block
      length = blockSize;
      b = block;
    } else if (blockIndicator === 1) { // short block
      length = lenModel.decode();
      b = block.subarray(0, length);
    } else if (blockIndicator === 2) { // all done, no more blocks
      break;
    }
    // read starting index for unBWT
    var pidx = lenModel.decode();
    // decode the alphabet subset used
    var useTree = Util.makeU16Buffer(512);
    useTree[0] = 1; // sentinel
    for (i = 1; i < 512; i++) {
      var parent = i >>> 1;
      var full = 1 << (9 - Util.fls(i));
      if (useTree[parent] === 0 || useTree[parent] === (full * 2)) {
        /* already known full/empty */
        useTree[i] = useTree[parent] >>> 1;
      } else if (i >= 256) {
        useTree[i] = decoder.decodeBit(); // leaf node
      } else {
        var v = decoder.decodeCulFreq(3);
        decoder.decodeUpdate(1, v, 3);
        useTree[i] = (v === 2) ? full : v;
      }
    }
    // remap symbols to this subset
    var alphabetSize = 0;
    for (i = 0; i < 256; i++) {
      if (useTree[256 + i]) { // symbol in use
        M[alphabetSize++] = i;
      }
    }
    useTree = null;
    // RLE/range decoding
    var model = new FenwickModel(decoder, alphabetSize + 1
      , F_PROB_MAX, F_PROB_INCR);
    if (fast) { model = new DefSumModel(decoder, alphabetSize + 1, true); }
    var val = 1; // repeat count
    for (i = 0; i < length;) {
      c = model.decode();
      if (c === 0) {
        for (j = 0; j < val; j++) { b[i++] = 0; }
        val *= 2;
      } else if (c === 1) {
        for (j = 0; j < val; j++) {
          b[i++] = 0;
          b[i++] = 0;
        }
        val *= 2;
      } else {
        val = 1;
        b[i++] = c - 1;
      }
    }
    // MTF decode
    for (i = 0; i < length; i++) {
      j = b[i];
      b[i] = c = M[j];
      // move to front
      for (; j > 0; j--) {
        M[j] = M[j - 1];
      }
      M[0] = c;
    }
    // unBWT
    BWT.unbwtransform(block, U, A, length, pidx);
    // emit!
    output.write(U, 0, length);
  }
  decoder.decodeFinish();
});

return BWTC;
}());


