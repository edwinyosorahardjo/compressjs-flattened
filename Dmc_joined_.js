var RangeCoder          //no dependencies
   ,Stream              //no dependencies
   ,Util                //depands on [Stream]
   ,MTFModel            //depands on [RangeCoder, Stream, Util(Stream)]
   ,Dmc                 //depands on [RangeCoder, Stream, Util(Stream), MTFModel(RangeCoder, Stream, Util(Stream))]
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


MTFModel = (function(){
/** Simple range coding model w/ escape, suitable for sparse symbol sets.
 *  Uses a move-to-front list, which is simple and relatively performant,
 *  but slows down a lot if you want to try to model escapes more precisely
 *  (which is why this feature is disabled by default).
 */

var DEFAULT_MAX_PROB = 0xFF00;
var DEFAULT_INCREMENT = 0x0100;

var NUMERIC_SORT = function(a, b) { return a - b; };

var MTFModel = function(coder, size, max_prob, increment, betterEscape) {
  this.coder = coder;
  this.increment = (+increment) || DEFAULT_INCREMENT;
  this.max_prob = (+max_prob) || DEFAULT_MAX_PROB;
  console.assert((this.max_prob + (this.increment - 1)) <= 0xFFFF);
  this.sym = Util.makeU16Buffer(size + 1);
  this.prob = Util.makeU16Buffer(size + 2);
  this.sym[0] = size; // escape code
  this.prob[0] = 0;
  this.seenSyms = 1;
  // total probability always found in this.prob[this.seenSyms]
  this.prob[this.seenSyms] = this.increment;
  this.numSyms = size;
  if (betterEscape) {
    this.sortedSeen = [size];
  }
};
MTFModel.factory = function(coder, max_prob, increment, betterEscape) {
  return function(size) {
    return new MTFModel(coder, size, max_prob, increment, betterEscape);
  };
};
MTFModel.prototype.clone = function() {
  var newModel = new MTFModel(this.coder, this.numSyms, this.max_prob
    , this.increment, !!this.sortedSeen);
  var i;
  for (i = 0; i < this.seenSyms; i++) {
    newModel.sym[i] = this.sym[i];
    newModel.prob[i] = this.prob[i];
  }
  newModel.prob[i] = this.prob[i]; // total probability
  newModel.seenSyms = this.seenSyms;
  if (this.sortedSeen) {
    newModel.sortedSeen = this.sortedSeen.slice(0);
  }
  return newModel;
};
MTFModel.prototype._update = function(symbol, index, sy_f) {
  var j, tot_f;
  // move this symbol to the end
  for (j = index; j < this.seenSyms - 1; j++) {
    this.sym[j] = this.sym[j + 1];
    this.prob[j] = this.prob[j + 1] - sy_f;
  }
  if (index < this.seenSyms) {
    this.sym[j] = symbol;
    this.prob[j] = this.prob[j + 1] - sy_f;
    // increase frequency for this symbol, and total freq at same time
    this.prob[this.seenSyms] = tot_f =
      this.prob[this.seenSyms] + this.increment;
    if (symbol === this.numSyms && this.seenSyms >= this.numSyms) {
      // this is the last time we'll see an escape! remove it.
      tot_f = this.prob[--this.seenSyms];
      if (this.sortedSeen) { this.sortedSeen.length--; }
    }
  } else { // add to the end
    tot_f = this.prob[this.seenSyms];
    this.sym[index] = symbol;
    this.prob[index] = tot_f;
    tot_f += this.increment;
    this.prob[++this.seenSyms] = tot_f;
    if (this.sortedSeen) {
      this.sortedSeen.push(symbol);
      // hopefully sort is very fast on a mostly-sorted array
      this.sortedSeen.sort(NUMERIC_SORT);
    }
  }
  if (tot_f >= this.max_prob) { this._rescale(); }
  return;
};
MTFModel.prototype._rescale = function() {
  var i, j, total = 0;
  var noEscape = true;
  if (this.sortedSeen) { this.sortedSeen.length = 0; }
  for (i = 0, j = 0; i < this.seenSyms; i++) {
    var sym = this.sym[i];
    var sy_f = this.prob[i + 1] - this.prob[i];
    sy_f >>>= 1;
    if (sy_f > 0) {
      if (sym === this.numSyms) {
        noEscape = false;
      }
      this.sym[j] = sym;
      this.prob[j++] = total;
      total += sy_f;
      if (this.sortedSeen) { this.sortedSeen.push(sym); }
    }
  }
  this.prob[j] = total;
  this.seenSyms = j;
  if (this.sortedSeen) {
    this.sortedSeen.sort(NUMERIC_SORT);
  }
  // don't allow escape to go to zero prob if we still need it
  if (noEscape && this.seenSyms < this.numSyms) {
    // NOTE this adds this.increment to escape freq; the FenwickModel
    //      just adds one.
    this._update(this.numSyms /*escape*/ , this.seenSyms /*at end*/ );
  }
};
MTFModel.prototype.decode = function() {
  var tot_f = this.prob[this.seenSyms];
  var prob = this.coder.decodeCulFreq(tot_f);
  // we're expecting to find the probability near the "most recent" side
  // of our array
  var i;
  for (i = this.seenSyms - 1; i >= 0; i--) {
    if (this.prob[i] <= prob /*&& prob < this.prob[i+1]*/ )
      break;
  }
  console.assert(i >= 0);
  var symbol = this.sym[i];
  var lt_f = this.prob[i];
  var sy_f = this.prob[i + 1] - lt_f;
  this.coder.decodeUpdate(sy_f, lt_f, tot_f);
  this._update(symbol, i, sy_f);
  if (symbol === this.numSyms) {
    /* this is an escape */
    /* decode the literal */
    sy_f = 1;
    tot_f = this.numSyms;
    if (this.sortedSeen) {
      // do a slower, but more precise decoding of the literal
      // by excluding the already-seen symbols.
      var seen = this.sortedSeen;
      tot_f = this.numSyms - this.seenSyms;
      if (seen[seen.length - 1] === this.numSyms) { tot_f++; }
      symbol = lt_f = this.coder.decodeCulFreq(tot_f);
      for (i = 0; i < seen.length && seen[i] <= symbol; i++) {
        symbol++;
      }
    } else {
      symbol = lt_f = this.coder.decodeCulFreq(tot_f);
    }
    this.coder.decodeUpdate(sy_f, lt_f, tot_f);
    this._update(symbol, this.seenSyms);
  }
  return symbol;
};
MTFModel.prototype.encode = function(symbol) {
  // look for symbol, from most-recent to oldest
  var i, sy_f, lt_f, tot_f;
  for (i = this.seenSyms - 1; i >= 0; i--) {
    if (symbol === this.sym[i]) {
      // ok, found it.
      lt_f = this.prob[i];
      sy_f = this.prob[i + 1] - lt_f;
      tot_f = this.prob[this.seenSyms];
      this.coder.encodeFreq(sy_f, lt_f, tot_f);
      return this._update(symbol, i, sy_f);
    }
  }
  // couldn't find this symbol.  encode as escape.
  console.assert(symbol !== this.numSyms); // catch infinite recursion
  this.encode(this.numSyms); // guaranteed to be found in the table.
  // code symbol as literal
  sy_f = 1;
  lt_f = symbol;
  tot_f = this.numSyms;
  if (this.sortedSeen) {
    // do a slower, but more precise encoding of the literal
    // by excluding the already-seen symbols.
    var seen = this.sortedSeen;
    tot_f -= this.seenSyms;
    if (seen[seen.length - 1] === this.numSyms) { tot_f++; }
    for (i = 0; i < seen.length && seen[i] < symbol; i++) {
      lt_f--;
    }
  }
  this.coder.encodeFreq(sy_f, lt_f, tot_f);
  // now add symbol to the end.
  return this._update(symbol, this.seenSyms);
};

MTFModel.MAGIC = 'mtfm';
/** Simple order-0 compressor, as self-test. */
MTFModel.compressFile = Util.compressFileHelper(MTFModel.MAGIC, function(inStream, outStream, fileSize, props, finalByte) {
  var range = new RangeCoder(outStream);
  range.encodeStart(finalByte, 1);
  var model = new MTFModel(range, (fileSize < 0) ? 257 : 256);
  Util.compressWithModel(inStream, fileSize, model);
  range.encodeFinish();
}, true);

/** Simple order-0 decompresser, as self-test. */
MTFModel.decompressFile = Util.decompressFileHelper(MTFModel.MAGIC, function(inStream, outStream, fileSize) {
  var range = new RangeCoder(inStream);
  range.decodeStart(true /*we already read the 'free' byte*/ );
  var model = new MTFModel(range, (fileSize < 0) ? 257 : 256);
  Util.decompressWithModel(outStream, fileSize, model);
  range.decodeFinish();
});

return MTFModel;

}());


Dmc = (function(){
/**
 * Implementation of Dynamic Markov Compression, using byte-oriented
 * nodes/transitions.
 *
 * Currently no model-shrinking is done, so be careful trying to use
 * this on large inputs!
 *
 * Notes for the future / TO DO:
 *
 * Add node merging to Dmc:
 *  - once (total states traversed / total node count) exceeds a certain value
 *    - find the median node w/rt total visits
 *    - combine all nodes w/ less visits into a single node, with transitions
 *      to node[0] - node[255] (initial context-1 states)
 *      - initially transition counts are zero?  or summed from components?
 *        needs to be summed so kirchoff principle holds
 *    - halve the edge counts of all nodes, to provide for adaptation
 *      - enforce property that all nodes point "higher" except for
 *        links to nodes 0-255.  So we can resum all nodes in one pass,
 *        after resetting all node.sum to zero. X YES because we know
 *        what the total sum must be, so we can arrange to scale to maintain
 *        proper sum. XXX what about node 0-255? XXX maybe just clear all
 *        edge counts XXX
 *
 * Fix buglet: ensure that kirchoff principle *exactly* holds by
 * paying attention to rounding when we distribute edge counts.  track
 * highest edge and give (desiredSum - newSum) extra counts to that
 * outgoing edge? add one to each nonzero edge until all gone?
 *
 * Split 'to' nodes when to.sum grows too high -- only if we're
 * highest incoming edge?  Fix bug again here with saturating counts;
 * we can't ignore counts w/o violating kirchoff principle, so we need
 * to clone it.  Maybe start trying to clone early (before our counter
 * saturates) so we have a better chance of cloning on the high
 * incoming edge? XXX we don't track incoming edges.  XXX so just
 * clone when we visit.
 */

// nm = no model cloning, MAX_TRANS_CNT=0xFF, MAX_MODEL_PROB=0xFFFF
// nm2 = "                            0xFFFF                 0xFFFF
// nm3 = "                             0xFFF                 0x0FFF
// nm4 = "                            0xFFFF                   0xFF
// cl1 = model cloning, MAX_TRANS_CNT=0xFFFF  MAX_MODEL_PROB=0xFF
// cl2 = model cloning, MAX_TRANS_CNT=  0xFF  MAX_MODEL_PROB=0xFF
// cl3 = model cloning, MAX_TRANS_CNT=0xFFFF  MAX_MODEL_PROB=0xFFFF
var MAX_TRANS_CNT = 0xFFFF;
var DEFAULT_MIN_CNT1 = 8;
var DEFAULT_MIN_CNT2 = 128;
var MODEL_PROB_MAX = 0xFF00;
var MODEL_PROB_INCR = 0x0100;
var CLONE_MODELS = false;
var PRINT_STATS = false; // for quick benchmarking

// XXX need to limit growth of model (throw away and retrain if model
//     gets too large)

var Dmc = Object.create(null);
Dmc.MAGIC = 'dmc!';

var MarkovNode = function(coder, size, optModel) {
  this.out = [];
  this.model = optModel ? optModel.clone() :
    new MTFModel(coder, size, MODEL_PROB_MAX, MODEL_PROB_INCR);
  this.count = Util.makeU16Buffer(size);
  this.sum = 0;
};
MarkovNode.prototype.clone = function(coder, size) {
  var i;
  var newNode = new MarkovNode(coder, size, CLONE_MODELS ? this.model : null);
  for (i = 0; i < size; i++) {
    newNode.out[i] = this.out[i];
  }
  return newNode;
};

var MarkovModel = function(coder, size, MIN_CNT1, MIN_CNT2) {
  var i, j;
  // initial model is 'size' states, completely linked.
  this.coder = coder;
  this.size = size;
  this.MIN_CNT1 = MIN_CNT1 || DEFAULT_MIN_CNT1;
  this.MIN_CNT2 = MIN_CNT2 || DEFAULT_MIN_CNT2;
  this.nodes = [];
  for (i = 0; i < size; i++) {
    this.nodes[i] = new MarkovNode(coder, size);
  }
  // now link nodes
  for (i = 0; i < size; i++) {
    for (j = 0; j < size; j++) {
      this.nodes[i].out[j] = this.nodes[j];
    }
  }
  // select an arbitrary node as the start state.
  this.current = this.nodes[0];
};
MarkovModel.prototype.maybeSplit = function(from, symbol, to) {
  var trans_cnt = from.count[symbol];
  var next_cnt = to.sum;
  var i;
  if ((trans_cnt <= this.MIN_CNT1) ||
    (next_cnt - trans_cnt <= this.MIN_CNT2)) {
    return to; // no split
  }

  // split this guy!
  var newNode = to.clone(this.coder, this.size);
  this.nodes.push(newNode);
  from.out[symbol] = newNode;
  // distribute transition counts among new and cloned node
  newNode.sum = to.sum = 0;
  for (i = 0; i < this.size; i++) {
    newNode.count[i] = to.count[i] * trans_cnt / next_cnt;
    newNode.sum += newNode.count[i];
    to.count[i] -= newNode.count[i];
    to.sum += to.count[i];
  }

  return newNode;
};
MarkovModel.prototype.encode = function(symbol) {
  var from = this.current;
  from.model.encode(symbol);
  var to = from.out[symbol];
  if (from.count[symbol] !== MAX_TRANS_CNT) {
    from.count[symbol]++;
    from.sum++;
  }
  this.current = this.maybeSplit(from, symbol, to);
};
MarkovModel.prototype.decode = function() {
  var from = this.current;
  var symbol = from.model.decode();
  var to = from.out[symbol];
  if (from.count[symbol] !== MAX_TRANS_CNT) {
    from.count[symbol]++;
    from.sum++;
  }
  this.current = this.maybeSplit(from, symbol, to);
  return symbol;
};

Dmc.compressFile = Util.compressFileHelper(Dmc.MAGIC, function(inStream, outStream, fileSize, props) {

  props = props || {};
  var MIN_CNT1 = (+props.m) || DEFAULT_MIN_CNT1;
  var MIN_CNT2 = (+props.n) || DEFAULT_MIN_CNT2;
  Util.writeUnsignedNumber(outStream, MIN_CNT1);
  Util.writeUnsignedNumber(outStream, MIN_CNT2);

  var range = new RangeCoder(outStream);
  range.encodeStart(0xCA, 0);

  var mm = new MarkovModel(range, (fileSize < 0) ? 257 : 256
    , MIN_CNT1, MIN_CNT2);
  var inSize = 0;
  while (inSize !== fileSize) {
    var ch = inStream.readByte();
    if (ch === Stream.EOF) {
      mm.encode(256); // end of stream
      break;
    }
    mm.encode(ch);
    inSize++;
  }
  var outSize = range.encodeFinish();
  if (PRINT_STATS) {
    console.log('M1', mm.MIN_CNT1, 'M2', mm.MIN_CNT2
      , 'states', mm.nodes.length, 'size', outSize);
  }
});

Dmc.decompressFile = Util.decompressFileHelper(Dmc.MAGIC, function(inStream, outStream, fileSize) {

  var MIN_CNT1 = Util.readUnsignedNumber(inStream);
  var MIN_CNT2 = Util.readUnsignedNumber(inStream);

  var range = new RangeCoder(inStream);
  range.decodeStart();

  var mm = new MarkovModel(range, (fileSize < 0) ? 257 : 256
    , MIN_CNT1, MIN_CNT2);
  var outSize = 0;
  while (outSize !== fileSize) {
    var ch = mm.decode();
    if (ch === 256) {
      break; // EOF
    }
    outStream.writeByte(ch);
    outSize++;
  }
  range.decodeFinish();
});

return Dmc;
}());


