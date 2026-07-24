type GuidVersions = 'uuidv1' | 'uuidv2' | 'uuidv3' | 'uuidv4' | 'uuidv5' | 'uuidv6' | 'uuidv7' | 'uuidv8';

export interface GuidOptions {
    version?: GuidVersions[] | GuidVersions;
    separator?: boolean | '-' | ':';
}
