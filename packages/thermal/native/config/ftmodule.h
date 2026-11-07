/* The FreeType modules of @lakutata/thermal (FT_CONFIG_MODULES_H, in place of include/freetype/config/ftmodule.h):
 * OpenType (CFF) and TrueType fonts, their hinting (the auto-hinter and the PostScript hinter), the anti-aliased and the
 * monochrome rasterizers. The gzip module is compiled too: the SFNT driver calls it for WOFF fonts. */
FT_USE_MODULE( FT_Module_Class, autofit_module_class )
FT_USE_MODULE( FT_Driver_ClassRec, tt_driver_class )
FT_USE_MODULE( FT_Driver_ClassRec, cff_driver_class )
FT_USE_MODULE( FT_Module_Class, psaux_module_class )
FT_USE_MODULE( FT_Module_Class, psnames_module_class )
FT_USE_MODULE( FT_Module_Class, pshinter_module_class )
FT_USE_MODULE( FT_Module_Class, sfnt_module_class )
FT_USE_MODULE( FT_Renderer_Class, ft_smooth_renderer_class )
FT_USE_MODULE( FT_Renderer_Class, ft_raster1_renderer_class )
