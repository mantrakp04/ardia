#ifndef ARDIA_LINUX_AC_LINUX_WINDOW_CAPTION_H_
#define ARDIA_LINUX_AC_LINUX_WINDOW_CAPTION_H_

namespace views { class Widget; }

namespace ardia::linux_window {

bool StartCaptionMove(views::Widget* widget);
bool CaptionDoubleClick(views::Widget* widget);

}

#endif
