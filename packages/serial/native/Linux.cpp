#ifdef __linux__

#include <cstdint>
#include <sys/ioctl.h>
#include <asm/ioctls.h>
#include <asm/termbits.h>

namespace serial {

    int setLinuxSpeed(int fd, uint32_t speed) {
        struct termios2 settings;
        if (ioctl(fd, TCGETS2, &settings) < 0) return -1;
        settings.c_cflag &= ~(CBAUD | (CBAUD << IBSHIFT));
        settings.c_cflag |= BOTHER | (BOTHER << IBSHIFT);
        settings.c_ispeed = speed;
        settings.c_ospeed = speed;
        return ioctl(fd, TCSETS2, &settings);
    }
}

#endif
