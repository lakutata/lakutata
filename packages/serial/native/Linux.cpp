#ifdef __linux__

#include <cerrno>
#include <cstdint>
#include <sys/ioctl.h>
#include <asm/ioctls.h>
#include <asm/termbits.h>

namespace serial {

    int setLinuxSpeed(int fd, uint32_t speed) {
#ifdef TCGETS2
        struct termios2 settings;
        if (ioctl(fd, TCGETS2, &settings) < 0) return -1;
        //The output speed only: an input speed of 0 follows it, so that a later standard speed (set by termios, which
        //knows one speed) is not left with a custom input speed
        settings.c_cflag &= ~(CBAUD | (CBAUD << IBSHIFT));
        settings.c_cflag |= BOTHER;
        settings.c_ispeed = speed;
        settings.c_ospeed = speed;
        return ioctl(fd, TCSETS2, &settings);
#else
        //No termios2 on this architecture (powerpc): the standard speeds only
        (void) fd;
        (void) speed;
        errno = EINVAL;
        return -1;
#endif
    }

    uint32_t linuxSpeed(int fd) {
#ifdef TCGETS2
        struct termios2 settings;
        if (ioctl(fd, TCGETS2, &settings) < 0) return 0;
        return settings.c_ospeed;
#else
        (void) fd;
        return 0;
#endif
    }
}

#endif
