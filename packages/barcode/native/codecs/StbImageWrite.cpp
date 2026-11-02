/* The implementation of stb_image_write (vendor/stb): the PNG of the barcodes made, written to memory only. Compiled as
   C++: the C compiler of MSVC for ARM64 does not take the products of floats initializing the static tables of its JPEG
   writer as constants (C2099). Its functions keep the C linkage (STBIWDEF). */
#define STBI_WRITE_NO_STDIO
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"
