//The modules of wuffs the addon builds: the decoders of the images read (PNG, JPEG, GIF, BMP, WebP, TGA), the modules
//they need, and its C++ API (wuffs_aux::DecodeImage). Given before every include of wuffs, its implementation
//(Wuffs.cpp) and its declarations (Read.cpp)
#pragma once

#define WUFFS_CONFIG__MODULES
#define WUFFS_CONFIG__MODULE__BASE
#define WUFFS_CONFIG__MODULE__AUX__BASE
#define WUFFS_CONFIG__MODULE__AUX__IMAGE
#define WUFFS_CONFIG__MODULE__ADLER32
#define WUFFS_CONFIG__MODULE__CRC32
#define WUFFS_CONFIG__MODULE__DEFLATE
#define WUFFS_CONFIG__MODULE__ZLIB
#define WUFFS_CONFIG__MODULE__PNG
#define WUFFS_CONFIG__MODULE__JPEG
#define WUFFS_CONFIG__MODULE__LZW
#define WUFFS_CONFIG__MODULE__GIF
#define WUFFS_CONFIG__MODULE__BMP
#define WUFFS_CONFIG__MODULE__VP8
#define WUFFS_CONFIG__MODULE__WEBP
#define WUFFS_CONFIG__MODULE__TARGA
