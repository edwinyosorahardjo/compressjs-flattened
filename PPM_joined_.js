"use strict";

var RangeCoder          //no dependencies
   ,Stream              //no dependencies
   ,Util                //depands on [Stream]
   ,PPM                 //depands on [RangeCoder, Util(Stream)]
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


PPM = (function(){
/** Particularly simple-minded implementation of PPM compression. */
var MAX_CONTEXT = 5;
var LOG_WINDOW_SIZE = 18;
var WINDOW_SIZE = 1 << LOG_WINDOW_SIZE;

var Window = function() {
  this.buffer = Util.makeU8Buffer(WINDOW_SIZE);
  this.pos = 0;
  this.firstPass = true;
  for (var i = 0; i < MAX_CONTEXT; i++) {
    this.put('cSaCsA'.charCodeAt(i % 6));
  }
};
Window.prototype.put = function(_byte) {
  this.buffer[this.pos++] = _byte;
  if (this.pos >= WINDOW_SIZE) { this.pos = 0;
    this.firstPass = false; }
  return _byte;
};
Window.prototype.get = function(pos) {
  return this.buffer[pos & (WINDOW_SIZE - 1)];
};
// the context ending just before 'pos'
Window.prototype.context = function(pos, n) {
  var c = []
    , i;
  pos = (pos - n) & (WINDOW_SIZE - 1);
  for (i = 0; i < n; i++) {
    c.push(this.buffer[pos++]);
    if (pos >= WINDOW_SIZE) { pos = 0; }
  }
  return String.fromCharCode.apply(String, c);
};

var DMM_INCREMENT = 0x100
  , DMM_MAX_PROB = 0xFF00;

var PPM = function(coder, size) {
  this.window = new Window();
  this.contexts = Object.create(null);
  // brain-dead '-1' context, using full exclusion
  var Cm1Context = function() {};
  Cm1Context.prototype.encode = function(symbol, exclude) {
    var i, lt_f = 0;
    for (i = 0; i < symbol; i++) {
      if (!exclude[i]) {
        lt_f++;
      }
    }
    var tot_f = size - exclude.total;
    coder.encodeFreq(1, lt_f, tot_f);
  };
  Cm1Context.prototype.decode = function(exclude) {
    var i, symbol, lt_f;
    var tot_f = size - exclude.total;
    symbol = lt_f = coder.decodeCulFreq(tot_f);
    for (i = 0; i <= symbol; i++) {
      if (exclude[i]) {
        symbol++;
      }
    }
    coder.decodeUpdate(1, lt_f, tot_f);
    return symbol;
  };
  this.cm1coder = new Cm1Context();

  var DenseMTFModel = function() {
    this.sym = [size];
    this.prob = [0, DMM_INCREMENT];
    this.refcount = 0;
  };
  DenseMTFModel.prototype._rescale = function() {
    var seenSyms = this.sym.length;
    var i, j, total = 0;
    var noEscape = true;
    for (i = 0, j = 0; i < seenSyms; i++) {
      var sym = this.sym[i];
      var sy_f = this.prob[i + 1] - this.prob[i];
      sy_f >>>= 1;
      if (sy_f > 0) {
        if (sym === size) {
          noEscape = false;
        }
        this.sym[j] = sym;
        this.prob[j++] = total;
        total += sy_f;
      }
    }
    this.prob[j] = total;
    seenSyms = this.sym.length = j;
    this.prob.length = seenSyms + 1;
    // don't allow escape to go to zero prob if we still need it
    if (noEscape && seenSyms < size) {
      total = this._update(size /*escape*/ , seenSyms /*at end*/ , 0, 1);
    }
    return total;
  };
  DenseMTFModel.prototype.update = function(symbol, incr) {
    // find symbol
    var i = 0;
    for (i = 0; i < this.sym.length; i++) {
      if (this.sym[i] === symbol) {
        return this._update(symbol, i, this.prob[i + 1] - this.prob[i], incr);
      }
    }
    // symbol escaped
    return this._update(symbol, i, 0, incr);
  };
  DenseMTFModel.prototype._update = function(symbol, index, sy_f, incr) {
    var seenSyms = this.sym.length;
    var i, j, tot_f;
    // move this symbol to the end
    for (j = index; j < seenSyms - 1; j++) {
      this.sym[j] = this.sym[j + 1];
      this.prob[j] = this.prob[j + 1] - sy_f;
    }
    // "method D" -- if we add a new escaped symbol, escape & the symbol
    // both increase by 1/2.
    if (index < seenSyms) {
      this.sym[j] = symbol;
      this.prob[j] = this.prob[j + 1] - sy_f;
      // increase frequency for this symbol, and total freq at same time
      this.prob[seenSyms] = tot_f =
        this.prob[seenSyms] + incr;
    } else { // add to the end
      tot_f = this.prob[seenSyms];
      this.sym[index] = symbol;
      this.prob[index] = tot_f;
      tot_f += incr;
      this.prob[++seenSyms] = tot_f;
      // remove probability of escape if table just filled up
      if (this.sym.length > size) {
        for (i = 0; i < seenSyms; i++) {
          if (size === this.sym[i]) {
            // found it.
            this._update(size, i, this.prob[i + 1] - this.prob[i], -1);
            this.sym.length--;
            this.prob.length--;
            tot_f = this.prob[this.prob.length - 1];
          }
        }
      }
    }
    if (tot_f >= DMM_MAX_PROB) { tot_f = this._rescale(); }
    return tot_f;
  };
  DenseMTFModel.prototype.encode = function(symbol, exclude) {
    // look for symbol, from most-recent to oldest
    var i, j, sy_f, lt_f, tot_f, seenSyms = this.sym.length;
    var ex_seen = 0
      , ex_lt_f = 0
      , ex_tot_f = 0
      , ex_sy_f;
    for (i = seenSyms - 1; i >= 0; i--) {
      lt_f = this.prob[i];
      sy_f = this.prob[i + 1] - lt_f;
      if (symbol === this.sym[i]) {
        // ok, found it.
        // count up the rest of the probabilities
        for (j = i - 1; j >= 0 && ex_seen < exclude.total; j--) {
          if (exclude[this.sym[j]]) {
            ex_seen += 1;
            ex_sy_f = this.prob[j + 1] - this.prob[j];
            ex_lt_f += ex_sy_f;
            ex_tot_f += ex_sy_f;
          }
        }
        tot_f = this.prob[seenSyms];
        // adjust by excluded symbols
        lt_f -= ex_lt_f;
        tot_f -= ex_tot_f;
        coder.encodeFreq(sy_f, lt_f, tot_f);
        if (symbol === size) { // only update table for escapes
          this._update(symbol, i, sy_f, DMM_INCREMENT / 2);
          return false; // escape.
        } // otherwise we'll do update later
        return true; // encoded character!
      } else if (exclude[this.sym[i]]) {
        ex_seen += 1;
        ex_tot_f += sy_f;
      }
    }
    // couldn't find this symbol.  encode as escape.
    this.encode(size, exclude);
    // add symbols to exclusion table
    console.assert(this.sym[this.sym.length - 1] === size); //escape
    for (i = 0; i < this.sym.length - 1; i++) {
      if (!exclude[this.sym[i]]) {
        exclude[this.sym[i]] = true;
        exclude.total++;
      }
    }
  };
  DenseMTFModel.prototype.decode = function(exclude) {
    var seenSyms = this.sym.length;
    var tot_f = this.prob[seenSyms];
    var ex_seen = 0
      , ex_lt_f = 0
      , ex_tot_f = 0
      , ex_sy_f;
    var i;
    for (i = seenSyms - 1; i >= 0 && ex_seen < exclude.total; i--) {
      if (exclude[this.sym[i]]) {
        ex_seen += 1;
        ex_tot_f += this.prob[i + 1] - this.prob[i];
      }
    }
    var prob = coder.decodeCulFreq(tot_f - ex_tot_f) + ex_tot_f;
    // we're expecting to find the probability near the "most recent" side
    // of our array
    ex_lt_f = ex_tot_f;
    for (i = seenSyms - 1; i >= 0; i--) {
      if (exclude[this.sym[i]]) {
        ex_sy_f = this.prob[i + 1] - this.prob[i];
        ex_lt_f -= ex_sy_f;
        prob -= ex_sy_f;
      } else if (this.prob[i] <= prob /*&& prob < this.prob[i+1]*/ )
        break;
    }
    console.assert(i >= 0);
    var symbol = this.sym[i];
    var lt_f = this.prob[i];
    var sy_f = this.prob[i + 1] - lt_f;
    coder.decodeUpdate(sy_f, lt_f - ex_lt_f, tot_f - ex_tot_f);
    // defer update
    if (symbol < size) { return symbol; }
    // an escape
    this._update(symbol, i, sy_f, DMM_INCREMENT / 2);
    // add symbols to exclusion table
    console.assert(this.sym[this.sym.length - 1] === size); //escape
    for (i = 0; i < this.sym.length - 1; i++) {
      if (!exclude[this.sym[i]]) {
        exclude[this.sym[i]] = true;
        exclude.total++;
      }
    }
    return -1;
  };
  this.newContext = function(initialSymbol) {
    return new DenseMTFModel();
  };
  this.newExclude = function() {
    var result = Object.create(null);
    result.total = 0; // no excluded symbols (yet)
    return result;
  };
  // set up some initial contexts
  (function() {
    var i, j;
    for (i = 0; i < MAX_CONTEXT; i++) {
      for (j = 0; j <= i; j++) {
        var cc = this.window.context(j + ((MAX_CONTEXT - 1) - i), j);
        if (!this.contexts[cc]) { this.contexts[cc] = this.newContext(); }
        this.contexts[cc].refcount++;
      }
    }
  })
  .call(this);
};
PPM.prototype.update = function(symbol, contextString, matchLevel) {
  // slide up the contexts, updating them
  var model, c, cc;
  for (c = 0; c <= MAX_CONTEXT; c++) {
    cc = contextString.slice(MAX_CONTEXT - c);
    model = this.contexts[cc];
    if (!model) {
      model = this.contexts[cc] = this.newContext();
    }
    if (c >= matchLevel) {
      // only update useful contexts
      model.update(symbol, DMM_INCREMENT / 2);
    }
    // refcount all contexts, whether used/updated or not
    model.refcount++;
  }
  // now garbage-collect old contexts
  contextString = this.window.context(this.window.pos + MAX_CONTEXT
    , MAX_CONTEXT);
  var firstPass = this.window.firstPass;
  for (c = MAX_CONTEXT; c >= 0 && !firstPass; c--) {
    cc = contextString.slice(0, c);
    model = this.contexts[cc];
    console.assert(model);
    if ((--model.refcount) <= 0) {
      console.assert(cc !== ''); // don't allow context-0 to be gc'ed!
      delete this.contexts[cc];
    }
  }
  // ok, advance window.
  this.window.put(symbol);
};
PPM.prototype.decode = function() {
  var contextString = this.window.context(this.window.pos, MAX_CONTEXT);
  var exclude = this.newExclude();
  var model, c, cc, symbol;
  for (c = MAX_CONTEXT; c >= 0; c--) {
    cc = contextString.slice(MAX_CONTEXT - c);
    model = this.contexts[cc];
    if (model) {
      symbol = model.decode(exclude);
      if (symbol >= 0) {
        this.update(symbol, contextString, c);
        return symbol;
      }
    }
  }
  // still no match, fall back to context -1
  symbol = this.cm1coder.decode(exclude);
  this.update(symbol, contextString, c);
  return symbol;
};
PPM.prototype.encode = function(symbol) {
  var contextString = this.window.context(this.window.pos, MAX_CONTEXT);
  var exclude = this.newExclude();
  var c;
  for (c = MAX_CONTEXT; c >= 0; c--) {
    var cc = contextString.slice(MAX_CONTEXT - c);
    var model = this.contexts[cc];
    if (model) {
      var success = model.encode(symbol, exclude);
      if (success) {
        this.update(symbol, contextString, c);
        return;
      }
    }
  }
  // fall back to context -1 (but still use exclusion table)
  this.cm1coder.encode(symbol, exclude);
  this.update(symbol, contextString, c);
  return;
};

PPM.MAGIC = 'ppm2';
PPM.compressFile = Util.compressFileHelper(PPM.MAGIC, function(inStream, outStream, fileSize, props, finalByte) {
  var range = new RangeCoder(outStream);
  range.encodeStart(finalByte, 1);
  var model = new PPM(range, (fileSize < 0) ? 257 : 256);
  Util.compressWithModel(inStream, fileSize, model);
  range.encodeFinish();
}, true);
PPM.decompressFile = Util.decompressFileHelper(PPM.MAGIC, function(inStream, outStream, fileSize) {
  var range = new RangeCoder(inStream);
  range.decodeStart(true /*we already read the 'free' byte*/ );
  var model = new PPM(range, (fileSize < 0) ? 257 : 256);
  Util.decompressWithModel(outStream, fileSize, model);
  range.decodeFinish();
});

return PPM;

}());


